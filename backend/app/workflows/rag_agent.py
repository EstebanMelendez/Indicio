import os
import time
import logging
from typing import List, Dict, Any, Optional
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from sqlalchemy.orm import Session
from app.models import Document, DocumentChunk, Folder, Vacancy, WorkflowAuditLog
from app.crypto import decrypt_sensitive_data
from app.fallback_service import call_groq_text
import google.generativeai as genai

logger = logging.getLogger("ChatbotRAG")

# Almacén de memoria conversacional por session_id (Web o chat_id de Telegram)
CHAT_HISTORIES: Dict[str, List[BaseMessage]] = {}
MAX_HISTORY_MESSAGES = 10

def get_session_history(session_id: str) -> List[BaseMessage]:
    if session_id not in CHAT_HISTORIES:
        CHAT_HISTORIES[session_id] = []
    return CHAT_HISTORIES[session_id]

def add_to_session_history(session_id: str, human_text: str, ai_text: str):
    history = get_session_history(session_id)
    history.append(HumanMessage(content=human_text))
    history.append(AIMessage(content=ai_text))
    if len(history) > MAX_HISTORY_MESSAGES:
        CHAT_HISTORIES[session_id] = history[-MAX_HISTORY_MESSAGES:]

def build_structured_catalog(db: Session, tenant_id: int, document_ids: Optional[List[int]] = None) -> str:
    """
    Construye un índice relacional ligero (SQL + JSONB descifrado) con el estado contable,
    carpeta actual, montos de facturas y puntajes de hojas de vida para responder preguntas
    globales o comparativas ("¿cuánto suman las facturas?", "¿qué facturas están aprobadas?", etc.).
    """
    q = db.query(Document).filter(Document.tenant_id == tenant_id, Document.status == "Procesado")
    if document_ids:
        q = q.filter(Document.id.in_(document_ids))
    docs = q.order_by(Document.id.desc()).limit(25).all()

    folders_map = {
        f.id: f.name for f in db.query(Folder).filter(Folder.tenant_id == tenant_id).all()
    }

    lines = []
    for d in docs:
        ext = d.extracted_data or {}
        if isinstance(ext, dict) and "_encrypted_data" in ext:
            dec = decrypt_sensitive_data(ext["_encrypted_data"])
            if isinstance(dec, dict):
                ext = dec
        folder_name = folders_map.get(d.folder_id, "Repositorio Raíz")
        if d.category and ("Factura" in d.category or "Recibo" in d.category):
            prov = ext.get("emisor_nombre") or ext.get("proveedor") or "N/A"
            nit = ext.get("emisor_nit") or "N/A"
            num = ext.get("numero_factura") or "N/A"
            total = ext.get("monto_total") or ext.get("total") or 0
            moneda = ext.get("moneda") or "COP"
            est = ext.get("estado_contable") or "Procesada"
            lines.append(
                f"- [FACTURA] Archivo `{d.filename}` | Carpeta: '{folder_name}' | Estado Contable: {est} | "
                f"Proveedor: {prov} (NIT: {nit}) | N°: {num} | Total: ${total} {moneda}"
            )
        elif d.category and ("Vida" in d.category or "Laboral" in d.category):
            postulante = ext.get("postulante") or "N/A"
            rol = ext.get("rol") or "N/A"
            exp = ext.get("anos_experiencia")
            score = ext.get("match_score")
            vac_title = ext.get("vacancy_title") or "General"
            skills = ", ".join(ext.get("competencias", [])[:8]) if isinstance(ext.get("competencias"), list) else ""
            lines.append(
                f"- [HOJA DE VIDA] Archivo `{d.filename}` | Carpeta: '{folder_name}' | Candidato: {postulante} | "
                f"Rol: {rol} | Experiencia: {exp} años | Match Score: {score}% (Vacante: {vac_title}) | Skills: {skills}"
            )
        else:
            lines.append(
                f"- [{d.category}] Archivo `{d.filename}` | Carpeta: '{folder_name}' | Resumen: {d.summary or ''}"
            )

    return "\n".join(lines) if lines else "No hay documentos procesados."

def execute_rag_with_memory(
    query: str,
    tenant_id: int,
    session_id: str,
    db: Session,
    user_email: str = "usuario@indicio.internal",
    document_ids: Optional[List[int]] = None,
    trigger_source: str = "WebChat"
) -> Dict[str, Any]:
    """
    Ejecuta el asistente conversacional RAG Híbrido (Vectorial pgvector + Metadatos SQL + Memoria LangChain)
    y registra la auditoría en WorkflowAuditLog.
    """
    start_time = time.time()
    api_key = os.getenv("GEMINI_API_KEY")
    emb_model = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-2")
    primary_model = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite")

    # 1. Contextualizar búsqueda con la última pregunta humana si es pregunta de seguimiento
    history = get_session_history(session_id)
    search_query = query
    if history:
        last_human_msgs = [m.content for m in history if isinstance(m, HumanMessage)]
        if last_human_msgs:
            search_query = f"{last_human_msgs[-1]} {query}"

    candidate_sources = []
    context_chunks = []
    try:
        q_emb = genai.embed_content(
            model=emb_model,
            content=search_query,
            task_type="retrieval_query",
            output_dimensionality=768
        )['embedding']

        dist_expr = DocumentChunk.embedding.cosine_distance(q_emb)
        base_query = db.query(DocumentChunk.chunk_text, Document.filename, dist_expr.label("dist")) \
                       .join(Document, DocumentChunk.document_id == Document.id) \
                       .filter(Document.tenant_id == tenant_id)

        if document_ids:
            valid_ids = [r[0] for r in db.query(Document.id).filter(
                Document.id.in_(document_ids),
                Document.tenant_id == tenant_id
            ).all()]
            if valid_ids:
                base_query = base_query.filter(Document.id.in_(valid_ids), dist_expr < 0.70)
        else:
            base_query = base_query.filter(dist_expr < 0.65)

        results = base_query.order_by(dist_expr).limit(6).all()
        for r in results:
            context_chunks.append(f"--- Fragmento de `{r[1]}` ---\n{r[0]}")
            if r[1] not in candidate_sources:
                candidate_sources.append(r[1])
    except Exception as e:
        logger.warning(f"Error recuperando chunks vectoriales: {e}")

    # 2. Construir índice relacional estructurado + historial de memoria
    structured_catalog = build_structured_catalog(db, tenant_id, document_ids)

    history_text = ""
    if history:
        history_lines = []
        for msg in history[-6:]:
            role = "Usuario" if isinstance(msg, HumanMessage) else "Asistente"
            history_lines.append(f"{role}: {msg.content}")
        history_text = "\nHISTORIAL RECIENTE DE ESTA CONVERSACIÓN:\n" + "\n".join(history_lines) + "\n"

    context_text = "\n\n".join(context_chunks) if context_chunks else "Sin fragmentos adicionales."

    system_prompt = f"""Eres el Asistente Inteligente de Indicio Enterprise (DocuMind).
Responde de forma clara, directa y bien estructurada basándote ÚNICAMENTE en la información documental de la empresa.
- Si el usuario hace una pregunta de seguimiento ("¿Y cuál es el teléfono de ella?", "¿Dónde vive él?", "¿Cuánto suman?"), usa el HISTORIAL RECIENTE para saber exactamente a qué persona o factura se refiere.
- Menciona siempre entre comillas o negrita el nombre exacto del archivo (ej. `hojavida_01.pdf`, `factura_01.txt`) del cual obtuviste el dato.

ÍNDICE ESTRUCTURADO DE DOCUMENTOS Y ESTADOS EN BASE DE DATOS:
{structured_catalog}

FRAGMENTOS DETALLADOS DE LOS DOCUMENTOS (RAG VECTORIAL):
{context_text}
{history_text}
PREGUNTA ACTUAL DEL USUARIO:
{query}"""

    # 3. Invocación con LangChain priorizando los modelos rápidos y libres de congestión
    answer = ""
    provider_used = f"{primary_model} (LangChain)"
    status_log = "SUCCESS"
    error_msg = None

    candidate_models = list(dict.fromkeys([
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        primary_model
    ]))

    success = False
    for model_name in candidate_models:
        try:
            llm = ChatGoogleGenerativeAI(
                model=model_name,
                google_api_key=api_key,
                temperature=0.2,
                timeout=15,
                max_retries=0
            )
            response = llm.invoke(system_prompt)
            raw_content = response.content if hasattr(response, "content") else str(response)
            if isinstance(raw_content, list):
                answer = "".join([part.get("text", str(part)) if isinstance(part, dict) else str(part) for part in raw_content])
            else:
                answer = str(raw_content)
            provider_used = f"{model_name} (LangChain)"
            error_msg = None
            success = True
            break
        except Exception as e:
            logger.warning(f"Fallo en {model_name} con LangChain: {e}. Saltando de inmediato al siguiente modelo...")
            error_msg = str(e)
            continue

    if not success:
        logger.warning("[RAG PLAN B] Todos los modelos de Gemini fallaron. Activando Plan B en Groq Cloud API...")
        groq_ans, groq_prov = call_groq_text(system_prompt, json_mode=False)
        if groq_ans:
            answer = groq_ans
            provider_used = groq_prov or "llama-3.3-70b-versatile (PlanB-Groq)"
            status_log = "SUCCESS"
            error_msg = None
            success = True
        else:
            status_log = "ERROR"
            answer = "⚠️ En este momento no pude consultar el modelo de inteligencia artificial. Por favor intenta de nuevo en unos instantes."

    # 4. Filtrado inteligente de fuentes citadas:
    # Mostrar en 'sources' únicamente los documentos que realmente se mencionan en la respuesta
    cited_sources = [src for src in candidate_sources if src.lower() in answer.lower()]
    final_sources = cited_sources if cited_sources else candidate_sources[:2]

    # 5. Actualizar memoria de sesión
    if status_log == "SUCCESS":
        add_to_session_history(session_id, query, answer)

    duration_ms = int((time.time() - start_time) * 1000)

    # 6. Guardar registro en WorkflowAuditLog
    try:
        audit_entry = WorkflowAuditLog(
            tenant_id=tenant_id,
            document_id=None,
            workflow_name="ChatbotRAG-LangChain",
            trigger_source=trigger_source,
            user_email=user_email,
            ai_provider=provider_used,
            input_summary=f"Query: {query[:120]} (Session: {session_id[:10]})",
            output_result={
                "answer_preview": answer[:160],
                "sources": final_sources,
                "history_length": len(history)
            },
            confidence_score=95 if final_sources else 75,
            status=status_log,
            error_message=error_msg,
            execution_time_ms=duration_ms
        )
        db.add(audit_entry)
        db.commit()
    except Exception as log_err:
        logger.warning(f"No se pudo guardar WorkflowAuditLog: {log_err}")

    return {
        "answer": answer,
        "sources": final_sources,
        "session_id": session_id,
        "duration_ms": duration_ms
    }
