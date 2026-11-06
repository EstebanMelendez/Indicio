import logging
from typing import Optional
from sqlalchemy.orm import Session
from app.models import Document
from app.crypto import decrypt_sensitive_data
from app.email_service import execute_hr_scouting_workflow, send_general_status_email

logger = logging.getLogger(__name__)


def notify_document_status(document: Document, db: Optional[Session] = None) -> None:
    """
    Orquestador de notificaciones post-procesamiento 100% en Python:
    1. Si es Hoja de Vida (RRHH), ejecuta el flujo de Headhunter y envía ficha interactiva por Gmail SMTP.
    2. Envía correo de notificación general de estado cuando GMAIL_APP_PASSWORD está configurado.
    (Las facturas >= $1.000.000 COP envían su correo interactivo directamente desde invoice_workflow.py).
    """
    extracted = document.extracted_data
    clean_extracted = {}
    if isinstance(extracted, dict):
        clean_extracted = dict(extracted)
        if "_encrypted_data" in clean_extracted:
            decrypted = decrypt_sensitive_data(clean_extracted["_encrypted_data"])
            if isinstance(decrypted, dict):
                clean_extracted.update(decrypted)
            clean_extracted.pop("_encrypted_data", None)

    is_hr = document.category and any(
        k in document.category for k in ["Hoja de Vida", "Perfiles Laborales", "Laboral", "Curriculum", "CV"]
    )
    is_invoice = document.category and any(
        k in document.category for k in ["Factura", "Recibo", "Cobro"]
    )

    # 1. Si es Hoja de Vida, ejecutar flujo Headhunter en Python (clasificación + correo interactivo si >= 80%)
    if is_hr and document.status == "Procesado" and db is not None:
        try:
            execute_hr_scouting_workflow(db=db, document=document, extracted=clean_extracted)
        except Exception as hr_err:
            logger.warning("Error en flujo HR Scouting en Python para doc %s: %s", document.id, hr_err)

    # 2. Notificación general por correo (para documentos que no sean facturas que ya enviaron su correo de aprobación)
    if not is_invoice:
        try:
            send_general_status_email(document=document, extracted=clean_extracted)
        except Exception as mail_err:
            logger.warning("No se pudo enviar correo general para doc %s: %s", document.id, mail_err)
