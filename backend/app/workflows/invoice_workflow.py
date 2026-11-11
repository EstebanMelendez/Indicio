import time
import logging
from typing import TypedDict, Optional, Dict, Any
from langgraph.graph import StateGraph, END
from sqlalchemy.orm import Session
from app.models import Document, Folder, WorkflowAuditLog
from app.crypto import encrypt_sensitive_data, decrypt_sensitive_data, build_protected_extracted_data

logger = logging.getLogger("InvoiceWorkflow")

# Estado compartido que fluye entre los nodos del grafo en LangGraph
class InvoiceState(TypedDict):
    tenant_id: int
    document_id: int
    user_email: str
    trigger_source: str
    emisor_nit: Optional[str]
    numero_factura: Optional[str]
    emisor_nombre: Optional[str]
    monto_total: float
    confidence_score: Optional[float]
    is_duplicate: bool
    requires_human_review: bool
    decision: str  # "APROBADA_AUTOMATICA", "DUPLICADA", "REQUIERE_REVISION", "PENDIENTE_APROBACION_GERENCIA"
    target_folder: str
    notes: str
    execution_time_ms: int
    start_time: float

def node_validate_confidence(state: InvoiceState) -> Dict[str, Any]:
    """Nodo 1: Revisa si la confianza de visión es menor al 80% (Human-in-the-Loop)"""
    confidence = state.get("confidence_score")
    # Si la confianza viene definida y es menor a 0.80 (80 puntos)
    if confidence is not None and confidence < 80:
        return {
            "requires_human_review": True,
            "decision": "REQUIERE_REVISION",
            "target_folder": "Requiere Revisión",
            "notes": f"Nivel de confianza visual bajo ({confidence}%). Se detiene flujo automático para revisión humana."
        }
    return {"requires_human_review": False}

def check_duplicate_in_db(db: Session, tenant_id: int, doc_id: int, emisor_nit: str, numero_factura: str) -> bool:
    """Verifica en PostgreSQL si ya existe una factura procesada con el mismo NIT y número"""
    if not emisor_nit or not numero_factura:
        return False
    
    docs = db.query(Document).filter(
        Document.tenant_id == tenant_id,
        Document.id != doc_id,
        Document.status.in_(["Procesado", "Aprobado"])
    ).all()

    for d in docs:
        ext = d.extracted_data or {}
        if isinstance(ext, dict) and "_encrypted_data" in ext:
            dec = decrypt_sensitive_data(ext["_encrypted_data"])
            if isinstance(dec, dict):
                ext = dec
        
        nit = str(ext.get("emisor_nit", "")).strip().lower()
        num = str(ext.get("numero_factura", "")).strip().lower()
        if nit == str(emisor_nit).strip().lower() and num == str(numero_factura).strip().lower():
            return True
            
    return False

def node_check_duplicate(state: InvoiceState, db: Session) -> Dict[str, Any]:
    """Nodo 2: Validación SQL de duplicados"""
    if state.get("requires_human_review"):
        return {}

    is_dup = check_duplicate_in_db(
        db=db,
        tenant_id=state["tenant_id"],
        doc_id=state["document_id"],
        emisor_nit=state.get("emisor_nit") or "",
        numero_factura=state.get("numero_factura") or ""
    )

    if is_dup:
        return {
            "is_duplicate": True,
            "decision": "DUPLICADA",
            "target_folder": "Facturas Duplicadas",
            "notes": f"Factura bloqueada por duplicidad: NIT {state.get('emisor_nit')} y consecutivo {state.get('numero_factura')} ya existen."
        }
    return {"is_duplicate": False}

def node_evaluate_amount(state: InvoiceState) -> Dict[str, Any]:
    """Nodo 3: Aplica la regla contable de los $1.000.000 COP"""
    if state.get("requires_human_review") or state.get("is_duplicate"):
        return {}

    monto = float(state.get("monto_total") or 0.0)
    UMBRAL_AUTOMATICO = 1000000.0  # $1.000.000 COP

    if monto < UMBRAL_AUTOMATICO:
        return {
            "decision": "APROBADA_AUTOMATICA",
            "target_folder": "Facturas Aprobadas",
            "notes": f"Aprobada automáticamente por regla contable: Monto ${monto:,.2f} menor a $1'000.000 COP."
        }
    else:
        return {
            "decision": "PENDIENTE_APROBACION_GERENCIA",
            "target_folder": "Pendientes de Aprobación",
            "notes": f"Requiere autorización gerencial: Monto ${monto:,.2f} supera el umbral de $1'000.000 COP."
        }

def build_invoice_graph(db: Session):
    """Construye el grafo LangGraph ejecutable para el flujo de Cuentas por Pagar"""
    workflow = StateGraph(InvoiceState)

    # Añadir nodos
    workflow.add_node("validate_confidence", node_validate_confidence)
    workflow.add_node("check_duplicate", lambda state: node_check_duplicate(state, db))
    workflow.add_node("evaluate_amount", node_evaluate_amount)

    # Enrutamiento condicional
    def route_after_confidence(state: InvoiceState):
        if state.get("requires_human_review"):
            return END
        return "check_duplicate"

    def route_after_duplicate(state: InvoiceState):
        if state.get("is_duplicate"):
            return END
        return "evaluate_amount"

    workflow.set_entry_point("validate_confidence")
    workflow.add_conditional_edges("validate_confidence", route_after_confidence)
    workflow.add_conditional_edges("check_duplicate", route_after_duplicate)
    workflow.add_edge("evaluate_amount", END)

    return workflow.compile()

def execute_invoice_workflow(
    db: Session,
    document: Document,
    user_email: str = "sistema@indicio.internal",
    trigger_source: str = "FastAPI-Vision"
) -> Dict[str, Any]:
    """
    Función de entrada para ejecutar el flujo contable 100% en código Python con LangGraph
    y registrar la auditoría obligatoria en PostgreSQL.
    """
    start_time = time.time()
    
    # Extraer metadatos contables del documento
    raw_ext = document.extracted_data or {}
    if isinstance(raw_ext, dict) and "_encrypted_data" in raw_ext:
        dec = decrypt_sensitive_data(raw_ext["_encrypted_data"])
        if isinstance(dec, dict):
            raw_ext = dec

    monto = raw_ext.get("monto_total") or raw_ext.get("total") or 0.0
    try:
        monto = float(monto)
    except Exception:
        monto = 0.0

    nit = raw_ext.get("emisor_nit")
    num_fac = raw_ext.get("numero_factura")
    proveedor = raw_ext.get("emisor_nombre") or raw_ext.get("proveedor")
    confidence = raw_ext.get("confidence_score")
    if confidence is not None:
        try:
            confidence = float(confidence)
            # Si viene en escala 0.0 - 1.0, pasar a escala 0 - 100
            if confidence <= 1.0:
                confidence = confidence * 100.0
        except Exception:
            confidence = 85.0

    initial_state: InvoiceState = {
        "tenant_id": document.tenant_id,
        "document_id": document.id,
        "user_email": user_email,
        "trigger_source": trigger_source,
        "emisor_nit": str(nit) if nit else None,
        "numero_factura": str(num_fac) if num_fac else None,
        "emisor_nombre": str(proveedor) if proveedor else None,
        "monto_total": monto,
        "confidence_score": confidence,
        "is_duplicate": False,
        "requires_human_review": False,
        "decision": "PENDIENTE",
        "target_folder": "Bandeja Entrada",
        "notes": "",
        "execution_time_ms": 0,
        "start_time": start_time
    }

    # Ejecutar el grafo de LangGraph
    app_graph = build_invoice_graph(db)
    final_state = app_graph.invoke(initial_state)

    duration_ms = int((time.time() - start_time) * 1000)
    final_state["execution_time_ms"] = duration_ms

    # 1. Mover documento a la carpeta resultante
    target_folder_name = final_state.get("target_folder", "Bandeja Entrada")
    folder = db.query(Folder).filter(
        Folder.name == target_folder_name,
        Folder.tenant_id == document.tenant_id
    ).first()
    if not folder:
        folder = Folder(name=target_folder_name, tenant_id=document.tenant_id)
        db.add(folder)
        db.commit()
        db.refresh(folder)

    document.folder_id = folder.id
    
    # Actualizar estado contable en el documento (Cifrado en reposo Ley 1581)
    updated_ext = dict(raw_ext)
    updated_ext["monto_total"] = monto
    updated_ext["total"] = monto
    updated_ext["emisor_nombre"] = proveedor
    updated_ext["proveedor"] = proveedor
    updated_ext["emisor_nit"] = nit
    updated_ext["numero_factura"] = num_fac
    updated_ext["confidence_score"] = confidence
    updated_ext["estado_contable"] = final_state["decision"]
    updated_ext["notas_auditoria"] = final_state["notes"]
    document.extracted_data = build_protected_extracted_data(updated_ext)

    # 2. Registrar en tabla de auditoría (WorkflowAuditLog)
    audit_entry = WorkflowAuditLog(
        tenant_id=document.tenant_id,
        document_id=document.id,
        workflow_name="CuentasPorPagar-LangGraph",
        trigger_source=trigger_source,
        user_email=user_email,
        ai_provider="LangGraph-RuleEngine",
        input_summary=f"Factura N° {num_fac or 'S/N'} | Proveedor: {proveedor or 'Desc.'} | Monto: ${monto:,.2f}",
        output_result={
            "decision": final_state["decision"],
            "target_folder": target_folder_name,
            "is_duplicate": final_state.get("is_duplicate", False),
            "requires_human_review": final_state.get("requires_human_review", False),
            "notes": final_state["notes"]
        },
        confidence_score=int(confidence) if confidence is not None else None,
        status="SUCCESS",
        execution_time_ms=duration_ms
    )
    db.add(audit_entry)
    db.commit()

    # 3. Si el monto supera $1.000.000 COP, enviar correo interactivo de aprobación gerencial directamente desde Python
    if final_state["decision"] == "PENDIENTE_APROBACION_GERENCIA":
        try:
            from app.email_service import send_invoice_approval_email
            email_res = send_invoice_approval_email(db=db, document=document, extracted=updated_ext)
            final_state["email_notification"] = email_res
        except Exception as mail_err:
            logger.warning(f"No se pudo enviar correo de aprobación gerencial: {mail_err}")

    logger.info(
        f"[LangGraph OK] Factura {document.id} procesada -> Decisión: {final_state['decision']} en {duration_ms}ms"
    )

    return final_state

