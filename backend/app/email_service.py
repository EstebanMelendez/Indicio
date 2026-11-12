import os
import hmac
import hashlib
import logging
import smtplib
import imaplib
import email
from email.header import decode_header
from email.utils import make_msgid
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import time
import threading
from typing import Dict, Any, Optional, Callable
from sqlalchemy.orm import Session
from app.models import Document, Folder, WorkflowAuditLog, Tenant, User
from app.crypto import decrypt_sensitive_data, encrypt_sensitive_data, mask_secret

logger = logging.getLogger("IndicioEmailService")

ALLOWED_ATTACHMENT_EXTS = {".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".webp"}


def _get_action_secret() -> str:
    return os.getenv("JWT_SECRET_KEY", "clave_secreta_indicio_muy_segura_2026_xyz")


def generate_email_action_token(doc_id: int, action: str) -> str:
    """Genera una firma HMAC-SHA256 para autenticar los clics en botones del correo sin requerir login en navegador."""
    msg = f"{doc_id}:{action}".encode("utf-8")
    secret = _get_action_secret().encode("utf-8")
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def verify_email_action_token(doc_id: int, action: str, token: str) -> bool:
    expected = generate_email_action_token(doc_id, action)
    return hmac.compare_digest(expected, token or "")


def get_tenant_gmail_config(db: Session, tenant_id: int) -> Dict[str, Any]:
    """
    Obtiene la configuración de correo Gmail enlazada al repositorio de una empresa (Tenant) específica.
    Descifra en memoria la Contraseña de Aplicación (Ley 1581).
    Para el Tenant #1 (Organización Principal), usa como respaldo las variables de backend/.env.
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    gmail_user = ""
    gmail_pass = ""

    if tenant:
        gmail_user = (tenant.gmail_user or "").strip()
        if tenant.gmail_app_password_enc:
            dec = decrypt_sensitive_data(tenant.gmail_app_password_enc)
            if isinstance(dec, dict):
                gmail_pass = (dec.get("app_password") or "").strip().replace(" ", "")
            elif isinstance(dec, str):
                gmail_pass = dec.strip().replace(" ", "")

    # Respaldo automático para la Organización Principal (Tenant #1) desde .env
    if tenant_id == 1:
        if not gmail_user:
            gmail_user = os.getenv("GMAIL_USER", "indicio.admin@gmail.com").strip()
        if not gmail_pass:
            gmail_pass = os.getenv("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")

    # Buscar correo del Admin de esa empresa como destinatario de respaldo para notificaciones
    admin_user = db.query(User).filter(User.tenant_id == tenant_id, User.role == "admin").order_by(User.id.asc()).first()
    fallback_recipient = gmail_user or (admin_user.email if admin_user else os.getenv("GMAIL_NOTIFY_TO", ""))

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant.name if tenant else f"Empresa #{tenant_id}",
        "gmail_user": gmail_user,
        "gmail_app_password": gmail_pass,
        "has_imap_credentials": bool(gmail_user and gmail_pass),
        "app_password_masked": mask_secret(gmail_pass) if gmail_pass else None,
        "notify_recipient": fallback_recipient,
        "storage_path": f"storage/tenant_{tenant_id}"
    }


def verify_gmail_imap_credentials(gmail_user: str, gmail_app_password: str) -> Dict[str, Any]:
    """Verifica en vivo si el correo Gmail y su Contraseña de Aplicación (16 letras) autentican por IMAP SSL."""
    clean_user = (gmail_user or "").strip()
    clean_pass = (gmail_app_password or "").strip().replace(" ", "")
    if not clean_user or not clean_pass:
        return {"valid": False, "reason": "Debe proporcionar el correo Gmail y la Contraseña de Aplicación."}
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(clean_user, clean_pass)
        mail.select("INBOX")
        mail.logout()
        return {"valid": True, "message": f"Conexión IMAP verificada exitosamente con {clean_user}."}
    except Exception as e:
        return {
            "valid": False,
            "reason": f"Google rechazó la conexión IMAP para '{clean_user}'. Verifique que sea una Contraseña de Aplicación de 16 letras válida ({e})."
        }


def send_html_email(
    subject: str,
    html_body: str,
    to_email: Optional[str] = None,
    gmail_label: Optional[str] = None,
    smtp_user: Optional[str] = None,
    smtp_pass: Optional[str] = None
) -> Dict[str, Any]:
    """
    Envía un correo HTML usando SMTP de Gmail con Contraseña de Aplicación
    (de la empresa enlazada o del relé principal en backend/.env)
    y aplica automáticamente la etiqueta de Gmail por IMAP.
    """
    env_user = os.getenv("GMAIL_USER", "indicio.admin@gmail.com").strip()
    env_pass = os.getenv("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")

    # Si la empresa tiene su propio Gmail + App Password enlazados, usar su propia cuenta SMTP/IMAP;
    # de lo contrario, usar el relé SMTP del sistema para enviar al correo configurado de la empresa.
    if smtp_user and smtp_pass:
        gmail_user = smtp_user.strip()
        gmail_pass = smtp_pass.strip().replace(" ", "")
    else:
        gmail_user = env_user
        gmail_pass = env_pass

    recipient = (to_email or smtp_user or os.getenv("GMAIL_NOTIFY_TO") or gmail_user).strip()

    if not gmail_user or not gmail_pass:
        return {
            "sent": False,
            "reason": "Falta enlazar la Contraseña de Aplicación de Gmail en la empresa o en backend/.env."
        }

    try:
        msg = MIMEMultipart("alternative")
        msg_id_hdr = make_msgid(domain="indicio.enterprise")
        msg["Message-ID"] = msg_id_hdr
        msg["Subject"] = subject
        msg["From"] = f"Indicio Enterprise <{gmail_user}>"
        msg["To"] = recipient
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=12) as server:
            server.login(gmail_user, gmail_pass)
            server.sendmail(gmail_user, [recipient], msg.as_string())

        # Si se indicó una etiqueta de Gmail, aplicarla automáticamente por IMAP
        if gmail_label:
            try:
                time.sleep(1.2)
                mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
                mail.login(gmail_user, gmail_pass)
                mail.select("INBOX")
                typ, data = mail.search(None, f'(HEADER Message-ID "{msg_id_hdr}")')
                target_ids = data[0].split() if (typ == "OK" and data and data[0]) else []
                if not target_ids:
                    typ_all, data_all = mail.search(None, "ALL")
                    if typ_all == "OK" and data_all and data_all[0]:
                        target_ids = [data_all[0].split()[-1]]
                for mid in target_ids:
                    mail.copy(mid, f'"{gmail_label}"')
                mail.logout()
            except Exception as lbl_err:
                logger.warning(f"[EMAIL LABEL WARN] No se pudo asignar etiqueta '{gmail_label}': {lbl_err}")

        logger.info(f"[EMAIL OK] Correo enviado a {recipient} (Etiqueta: {gmail_label}): {subject}")
        return {"sent": True, "recipient": recipient, "label": gmail_label}
    except Exception as e:
        logger.warning(f"[EMAIL ERROR] No se pudo enviar correo '{subject}': {e}")
        return {"sent": False, "reason": str(e)}


def _get_public_base_url() -> str:
    """Obtiene la URL pública del backend (soporta variable explícita o autodetección en Railway)."""
    explicit = os.getenv("BACKEND_PUBLIC_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway_domain:
        return f"https://{railway_domain}".rstrip("/")
    return "http://localhost:8000"


def send_invoice_approval_email(db: Session, document: Document, extracted: Dict[str, Any]) -> Dict[str, Any]:
    """
    Envía el correo interactivo al gerente cuando una factura >= $1.000.000 COP requiere aprobación.
    Los botones apuntan directamente al backend FastAPI (/api/documents/{id}/email-action).
    """
    start_time = time.time()
    base_url = _get_public_base_url()

    approve_token = generate_email_action_token(document.id, "approve_invoice")
    reject_token = generate_email_action_token(document.id, "reject_invoice")

    approve_url = f"{base_url}/api/documents/{document.id}/email-action?action=approve_invoice&token={approve_token}"
    reject_url = f"{base_url}/api/documents/{document.id}/email-action?action=reject_invoice&token={reject_token}"

    proveedor = extracted.get("emisor_nombre") or extracted.get("proveedor") or "Proveedor No Especificado"
    nit = extracted.get("emisor_nit") or "N/A"
    num_fac = extracted.get("numero_factura") or "S/N"
    fecha = extracted.get("fecha_emision") or "N/A"
    moneda = extracted.get("moneda") or "COP"
    conf = extracted.get("confidence_score") or 90
    try:
        monto = float(extracted.get("monto_total") or extracted.get("total") or 0.0)
    except Exception:
        monto = 0.0

    items = extracted.get("items") or []
    items_rows = ""
    if isinstance(items, list) and items:
        for it in items[:8]:
            if isinstance(it, dict):
                desc = it.get("descripcion", "Ítem")
                cant = it.get("cantidad", 1)
                sub = float(it.get("subtotal") or it.get("precio_unitario") or 0)
                items_rows += f"""
                <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">{desc}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;text-align:center;">{cant}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${sub:,.0f}</td>
                </tr>"""

    items_table_html = ""
    if items_rows:
        items_table_html = f"""
        <h4 style="margin:18px 0 8px 0;color:#1e293b;font-size:14px;">📦 Ítems Detectados por Visión / IA:</h4>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;overflow:hidden;">
            <thead>
                <tr style="background:#e2e8f0;color:#475569;font-size:12px;text-align:left;">
                    <th style="padding:8px 12px;">Descripción</th>
                    <th style="padding:8px 12px;text-align:center;">Cant.</th>
                    <th style="padding:8px 12px;text-align:right;">Subtotal</th>
                </tr>
            </thead>
            <tbody>{items_rows}</tbody>
        </table>"""

    subject = f"⚠️ [Aprobación Gerencial] Factura {num_fac} - {proveedor} (${monto:,.0f} {moneda})"
    html_body = f"""
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:24px;color:#ffffff;">
            <span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;">CUENTAS POR PAGAR • LANGGRAPH PYTHON</span>
            <h2 style="margin:10px 0 4px 0;font-size:20px;">Autorización de Factura Mayor a $1.000.000 COP</h2>
            <p style="margin:0;font-size:13px;opacity:0.9;">Archivo: <strong>{document.filename}</strong> | Subido por: {document.uploaded_by or 'Sistema'}</p>
        </div>
        <div style="padding:24px;">
            <p style="margin-top:0;color:#334155;font-size:14px;">El motor contable en código detectó una factura legítima (no duplicada) cuyo monto supera el tope de aprobación automática:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:12px;padding:12px;">
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Proveedor / Emisor:</td><td style="padding:8px 14px;font-weight:700;color:#0f172a;font-size:14px;">{proveedor}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">NIT:</td><td style="padding:8px 14px;font-weight:600;color:#1e293b;font-size:13px;">{nit}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Número de Factura:</td><td style="padding:8px 14px;font-weight:600;color:#1e293b;font-size:13px;">{num_fac}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Fecha de Emisión:</td><td style="padding:8px 14px;color:#1e293b;font-size:13px;">{fecha}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Confianza Visual IA:</td><td style="padding:8px 14px;color:#16a34a;font-weight:700;font-size:13px;">{conf}%</td></tr>
                <tr style="border-top:1px solid #e2e8f0;"><td style="padding:12px 14px;color:#0f172a;font-weight:700;font-size:14px;">MONTO TOTAL:</td><td style="padding:12px 14px;color:#dc2626;font-weight:800;font-size:18px;">${monto:,.2f} {moneda}</td></tr>
            </table>
            {items_table_html}
            <div style="margin-top:26px;text-align:center;">
                <a href="{approve_url}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;margin-right:12px;font-size:14px;">✅ Aprobar Pago de Factura</a>
                <a href="{reject_url}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;font-size:14px;">❌ Rechazar Factura</a>
            </div>
            <p style="margin-top:20px;font-size:11px;color:#94a3b8;text-align:center;">Al hacer clic en cualquiera de los botones, Indicio Enterprise actualizará automáticamente la carpeta y el estado contable en PostgreSQL.</p>
        </div>
    </div>
    """

    t_cfg = get_tenant_gmail_config(db, document.tenant_id or 1)
    if not t_cfg["has_imap_credentials"]:
        res = {
            "sent": False,
            "reason": f"La empresa '{t_cfg['tenant_name']}' aún no tiene un correo Gmail y Contraseña de Aplicación enlazados en 'Usuarios y Roles'."
        }
    else:
        res = send_html_email(
            subject,
            html_body,
            to_email=t_cfg["notify_recipient"],
            gmail_label="APROBACIONES PENDIENTES",
            smtp_user=t_cfg["gmail_user"],
            smtp_pass=t_cfg["gmail_app_password"]
        )
    duration_ms = int((time.time() - start_time) * 1000)

    try:
        log = WorkflowAuditLog(
            tenant_id=document.tenant_id,
            document_id=document.id,
            workflow_name="NotificacionCorreo-AprobacionFactura",
            trigger_source="FastAPI-SMTP",
            user_email=document.uploaded_by or "sistema@indicio.internal",
            ai_provider="Gmail-SMTP-Python",
            input_summary=f"Solicitud aprobación gerencial Factura {num_fac} (${monto:,.0f})",
            output_result=res,
            confidence_score=int(float(conf)) if conf else 95,
            status="SUCCESS" if res.get("sent") else "PENDING_CONFIG",
            error_message=None if res.get("sent") else res.get("reason"),
            execution_time_ms=duration_ms
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.warning(f"No se pudo guardar log de correo de factura: {e}")

    return res


def execute_hr_scouting_workflow(db: Session, document: Document, extracted: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reemplaza 100% en Python el flujo 'Headhunter Autónomo & Scouting RRHH' de n8n:
    - Si match_score < 80%: Mueve automáticamente el CV a 'Banco de Talentos' (EN_RESERVA).
    - Si match_score >= 80%: Envía ficha interactiva por Gmail con botones para 'Candidatos Seleccionados' o 'Banco de Talentos'.
    """
    start_time = time.time()
    try:
        score = float(extracted.get("match_score") or 0.0)
    except Exception:
        score = 0.0

    postulante = extracted.get("postulante") or document.filename
    rol = extracted.get("rol") or "Perfil Profesional"
    vac_title = extracted.get("vacancy_title") or "Vacante General"
    exp = extracted.get("anos_experiencia") or 0
    resumen = extracted.get("resumen_scouting") or document.summary or ""

    if score < 80.0:
        # Enrutamiento automático a Banco de Talentos
        folder = db.query(Folder).filter(Folder.name == "Banco de Talentos", Folder.tenant_id == document.tenant_id).first()
        if not folder:
            folder = Folder(name="Banco de Talentos", tenant_id=document.tenant_id)
            db.add(folder)
            db.commit()
            db.refresh(folder)
        document.folder_id = folder.id
        extracted["estado_contable"] = "EN_RESERVA"
        db.commit()

        duration_ms = int((time.time() - start_time) * 1000)
        db.add(WorkflowAuditLog(
            tenant_id=document.tenant_id,
            document_id=document.id,
            workflow_name="HeadhunterRRHH-Python",
            trigger_source="FastAPI-HR",
            user_email=document.uploaded_by or "sistema@indicio.internal",
            ai_provider="HybridMatch-RuleEngine",
            input_summary=f"CV: {postulante} | Score: {score}% (< 80%)",
            output_result={"decision": "EN_RESERVA", "target_folder": "Banco de Talentos"},
            confidence_score=int(score) if score > 0 else 75,
            status="SUCCESS",
            execution_time_ms=duration_ms
        ))
        db.commit()
        return {"decision": "EN_RESERVA", "folder": "Banco de Talentos"}

    # Si score >= 80%, enviar correo interactivo de Scouting al gerente
    base_url = _get_public_base_url()
    hire_token = generate_email_action_token(document.id, "hire_candidate")
    pool_token = generate_email_action_token(document.id, "reserve_candidate")

    hire_url = f"{base_url}/api/documents/{document.id}/email-action?action=hire_candidate&token={hire_token}"
    pool_url = f"{base_url}/api/documents/{document.id}/email-action?action=reserve_candidate&token={pool_token}"

    subject = f"[Scouting Top {score}%] {postulante} - {rol} - Candidato Destacado 🎯 Ficha de Scouting ({vac_title})"
    html_body = f"""
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0f766e,#14b8a6);padding:24px;color:#ffffff;">
            <span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;">HEADHUNTER IA • EMPAREJAMIENTO HÍBRIDO</span>
            <h2 style="margin:10px 0 4px 0;font-size:20px;">Candidato Sobresaliente Detectado ({score}%)</h2>
            <p style="margin:0;font-size:13px;opacity:0.9;">Vacante: <strong>{vac_title}</strong></p>
        </div>
        <div style="padding:24px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;background:#f8fafc;border-radius:12px;">
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Postulante:</td><td style="padding:8px 14px;font-weight:700;color:#0f172a;">{postulante}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Rol / Perfil:</td><td style="padding:8px 14px;color:#1e293b;">{rol}</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Experiencia:</td><td style="padding:8px 14px;color:#1e293b;">{exp} años</td></tr>
                <tr><td style="padding:8px 14px;color:#64748b;font-size:13px;">Match Score Híbrido:</td><td style="padding:8px 14px;color:#0f766e;font-weight:800;font-size:16px;">{score}%</td></tr>
            </table>
            <p style="font-size:13px;color:#334155;background:#f1f5f9;padding:12px;border-radius:8px;"><strong> Concepto IA:</strong> {resumen}</p>
            <div style="margin-top:24px;text-align:center;">
                <a href="{hire_url}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;margin-right:10px;font-size:14px;">✅ Preseleccionar (Entrevista)</a>
                <a href="{pool_url}" style="display:inline-block;background:#64748b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">📁 Enviar a Banco de Talentos</a>
            </div>
        </div>
    </div>
    """
    t_cfg = get_tenant_gmail_config(db, document.tenant_id or 1)
    if not t_cfg["has_imap_credentials"]:
        res = {
            "sent": False,
            "reason": f"La empresa '{t_cfg['tenant_name']}' aún no tiene un correo Gmail y Contraseña de Aplicación enlazados en 'Usuarios y Roles'."
        }
    else:
        res = send_html_email(
            subject,
            html_body,
            to_email=t_cfg["notify_recipient"],
            gmail_label="HOJAS DE VIDA / RRHH",
            smtp_user=t_cfg["gmail_user"],
            smtp_pass=t_cfg["gmail_app_password"]
        )
    duration_ms = int((time.time() - start_time) * 1000)

    db.add(WorkflowAuditLog(
        tenant_id=document.tenant_id,
        document_id=document.id,
        workflow_name="HeadhunterRRHH-Python",
        trigger_source="FastAPI-HR",
        user_email=document.uploaded_by or "sistema@indicio.internal",
        ai_provider="Gmail-SMTP-Python",
        input_summary=f"Ficha Scouting enviada: {postulante} ({score}%)",
        output_result=res,
        confidence_score=int(score),
        status="SUCCESS" if res.get("sent") else "PENDING_CONFIG",
        error_message=None if res.get("sent") else res.get("reason"),
        execution_time_ms=duration_ms
    ))
    db.commit()
    return res


def send_general_status_email(document: Document, extracted: Dict[str, Any], db: Optional[Session] = None) -> Dict[str, Any]:
    """Envía el correo de notificación general a la cuenta Gmail exclusiva de la empresa cuando finaliza el procesamiento."""
    subject = f"📄 Documento procesado en Indicio: {document.filename} ({document.status})"
    html_body = f"""
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
        <h3 style="margin-top:0;color:#1e293b;">Actualización de Documento – Indicio Enterprise</h3>
        <p style="font-size:14px;color:#334155;">Tu archivo ha finalizado su análisis inteligente:</p>
        <ul style="font-size:13px;color:#334155;line-height:1.7;">
            <li><strong>Archivo:</strong> {document.filename}</li>
            <li><strong>Categoría:</strong> {document.category or 'Sin clasificar'}</li>
            <li><strong>Estado:</strong> {document.status}</li>
            <li><strong>Estado Contable / Flujo:</strong> {extracted.get('estado_contable') or 'Procesado'}</li>
        </ul>
        <p style="font-size:13px;color:#475569;background:#f8fafc;padding:12px;border-radius:8px;">{document.summary or ''}</p>
    </div>
    """
    if db is not None:
        t_cfg = get_tenant_gmail_config(db, document.tenant_id or 1)
        if not t_cfg["has_imap_credentials"]:
            return {"sent": False, "reason": "Empresa sin Gmail enlazado."}
        return send_html_email(
            subject,
            html_body,
            to_email=t_cfg["notify_recipient"],
            smtp_user=t_cfg["gmail_user"],
            smtp_pass=t_cfg["gmail_app_password"]
        )
    return send_html_email(subject, html_body)


# Conjunto en memoria de adjuntos de correo ya descargados en esta sesión (Message-ID + nombre)
PROCESSED_EMAIL_ATTACHMENTS = set()


def _sync_single_tenant_inbox(
    tenant_id: int,
    gmail_user: str,
    gmail_pass: str,
    db_session_factory: Callable[[], Session],
    process_callback: Callable[[int, str, str], None],
    include_recent_read: bool = False
) -> Dict[str, Any]:
    """Sincroniza la bandeja de entrada de una empresa (tenant_id) hacia su repositorio aislado storage/tenant_{tenant_id}/."""
    if not gmail_user or not gmail_pass:
        return {
            "checked": False,
            "downloaded": 0,
            "files": [],
            "tenant_id": tenant_id,
            "reason": "Esta empresa aún no tiene un correo Gmail y Contraseña de Aplicación enlazados a su repositorio. Ve a 'Usuarios y Roles -> Enlace Gmail' para configurarlo."
        }

    downloaded_files = []
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(gmail_user, gmail_pass)
        mail.select("INBOX")

        # 1. Buscar primero correos NO LEÍDOS
        status, messages = mail.search(None, '(UNSEEN)')
        msg_ids = messages[0].split()[-8:] if (status == "OK" and messages and messages[0]) else []

        # 2. Si se invocó desde el botón manual "Sincronizar Gmail" y no había UNSEEN,
        # revisar los últimos 5 correos recibidos en la bandeja evitando duplicados.
        if include_recent_read and not msg_ids:
            status_all, messages_all = mail.search(None, 'ALL')
            if status_all == "OK" and messages_all and messages_all[0]:
                msg_ids = messages_all[0].split()[-5:]

        if not msg_ids:
            mail.logout()
            return {"checked": True, "downloaded": 0, "files": [], "tenant_id": tenant_id, "gmail_user": gmail_user}

        for m_id in msg_ids:
            res, msg_data = mail.fetch(m_id, "(RFC822)")
            if res != "OK":
                continue
            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue
                msg = email.message_from_bytes(response_part[1])
                sender = msg.get("From", "correo@externo.com")
                subject_hdr = msg.get("Subject", "")
                msg_uid = msg.get("Message-ID") or str(m_id)

                # Ignorar correos autogenerados por el propio sistema Indicio (notificaciones salientes)
                if "Indicio Enterprise" in sender or "Aprobación Gerencial" in subject_hdr or "Documento procesado en Indicio" in subject_hdr:
                    continue

                for part in msg.walk():
                    if part.get_content_maintype() == "multipart":
                        continue
                    if part.get("Content-Disposition") is None:
                        continue

                    raw_filename = part.get_filename()
                    if not raw_filename:
                        continue

                    decoded_parts = decode_header(raw_filename)
                    filename = ""
                    for part_str, enc in decoded_parts:
                        if isinstance(part_str, bytes):
                            filename += part_str.decode(enc or "utf-8", errors="ignore")
                        else:
                            filename += str(part_str)

                    clean_base = os.path.basename(filename).strip()
                    ext = os.path.splitext(clean_base)[1].lower()
                    if ext not in ALLOWED_ATTACHMENT_EXTS:
                        continue

                    dedup_key = f"tenant_{tenant_id}::{msg_uid}::{clean_base}"
                    if dedup_key in PROCESSED_EMAIL_ATTACHMENTS:
                        continue

                    payload_bytes = part.get_payload(decode=True)
                    if not payload_bytes:
                        continue

                    db = db_session_factory()
                    try:
                        # Verificar también en BD que no se haya importado ya ese mismo adjunto en el repositorio de esta empresa
                        existing = db.query(Document).filter(
                            Document.tenant_id == tenant_id,
                            Document.filename.ilike(f"%_{clean_base}"),
                            Document.file_size_bytes == len(payload_bytes)
                        ).first()
                        if existing:
                            PROCESSED_EMAIL_ATTACHMENTS.add(dedup_key)
                            continue

                        safe_name = f"email_{int(time.time())}_{clean_base}"
                        tenant_dir = os.path.join("storage", f"tenant_{tenant_id}")
                        os.makedirs(tenant_dir, exist_ok=True)
                        file_path = os.path.join(tenant_dir, safe_name)

                        with open(file_path, "wb") as f:
                            f.write(payload_bytes)

                        folder = db.query(Folder).filter(Folder.name == "Bandeja Correo", Folder.tenant_id == tenant_id).first()
                        if not folder:
                            folder = Folder(name="Bandeja Correo", tenant_id=tenant_id)
                            db.add(folder)
                            db.commit()
                            db.refresh(folder)

                        new_doc = Document(
                            tenant_id=tenant_id,
                            filename=safe_name,
                            file_path=file_path,
                            mime_type=part.get_content_type() or "application/octet-stream",
                            file_size_bytes=len(payload_bytes),
                            status="Pendiente",
                            folder_id=folder.id,
                            uploaded_by=f"Gmail-IMAP ({sender[:40]})"
                        )
                        db.add(new_doc)
                        db.commit()
                        db.refresh(new_doc)

                        db.add(WorkflowAuditLog(
                            tenant_id=tenant_id,
                            document_id=new_doc.id,
                            workflow_name="IngestaCorreo-IMAP",
                            trigger_source="Gmail-IMAP",
                            user_email=gmail_user,
                            ai_provider="Python-IMAP-Worker",
                            input_summary=f"Adjunto recibido de {sender[:45]}: {safe_name} -> storage/tenant_{tenant_id}/",
                            output_result={
                                "folder": "Bandeja Correo",
                                "document_id": new_doc.id,
                                "tenant_id": tenant_id,
                                "gmail_user": gmail_user,
                                "decision": "DESCARGADO_A_BANDEJA_CORREO"
                            },
                            confidence_score=100,
                            status="SUCCESS",
                            execution_time_ms=120
                        ))
                        db.commit()
                        doc_id = new_doc.id
                        PROCESSED_EMAIL_ATTACHMENTS.add(dedup_key)
                    finally:
                        db.close()

                    # Procesar el documento en un hilo independiente
                    threading.Thread(
                        target=process_callback,
                        args=(doc_id, file_path, safe_name),
                        daemon=True
                    ).start()
                    downloaded_files.append(safe_name)

        mail.logout()
        return {
            "checked": True,
            "downloaded": len(downloaded_files),
            "files": downloaded_files,
            "tenant_id": tenant_id,
            "gmail_user": gmail_user
        }
    except Exception as e:
        logger.warning(f"[IMAP WARN] Error revisando bandeja de Gmail (Tenant #{tenant_id} - {gmail_user}): {e}")
        return {"checked": False, "downloaded": 0, "files": [], "tenant_id": tenant_id, "reason": str(e)}


def check_gmail_inbox_once(
    db_session_factory: Callable[[], Session],
    process_callback: Callable[[int, str, str], None],
    include_recent_read: bool = False,
    target_tenant_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Revisa por IMAP (imap.gmail.com) los correos con archivos adjuntos de la empresa solicitada
    (o de todas las empresas con Gmail enlazado cuando corre en segundo plano),
    descargándolos directamente a storage/tenant_{id}/ y en la carpeta 'Bandeja Correo' de cada empresa.
    """
    db = db_session_factory()
    try:
        if target_tenant_id is not None:
            cfg = get_tenant_gmail_config(db, target_tenant_id)
            return _sync_single_tenant_inbox(
                tenant_id=target_tenant_id,
                gmail_user=cfg["gmail_user"],
                gmail_pass=cfg["gmail_app_password"],
                db_session_factory=db_session_factory,
                process_callback=process_callback,
                include_recent_read=include_recent_read
            )

        # Modo worker en segundo plano: sincronizar cada empresa que tenga credenciales IMAP enlazadas
        tenants = db.query(Tenant).order_by(Tenant.id.asc()).all()
        configs_to_sync = []
        seen_accounts = set()
        for t in tenants:
            cfg = get_tenant_gmail_config(db, t.id)
            if cfg["has_imap_credentials"]:
                acct_key = cfg["gmail_user"].lower()
                # Si dos empresas enlazaron cuentas distintas, sincronizar cada una a su propio tenant_id
                if acct_key not in seen_accounts:
                    seen_accounts.add(acct_key)
                    configs_to_sync.append(cfg)
    finally:
        db.close()

    total_downloaded = 0
    all_files = []
    for cfg in configs_to_sync:
        res = _sync_single_tenant_inbox(
            tenant_id=cfg["tenant_id"],
            gmail_user=cfg["gmail_user"],
            gmail_pass=cfg["gmail_app_password"],
            db_session_factory=db_session_factory,
            process_callback=process_callback,
            include_recent_read=include_recent_read
        )
        total_downloaded += res.get("downloaded", 0)
        all_files.extend(res.get("files", []))

    return {"checked": True, "downloaded": total_downloaded, "files": all_files}


