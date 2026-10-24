import logging
import os
import httpx
from app.models import Document
from app.crypto import decrypt_sensitive_data

logger = logging.getLogger(__name__)

def notify_document_status(document: Document) -> None:
    webhook_url = os.getenv("N8N_WEBHOOK_URL")
    invoice_webhook_url = os.getenv("N8N_INVOICE_WEBHOOK_URL", "http://localhost:5678/webhook/invoice-approval")
    hr_webhook_url = os.getenv("N8N_HR_WEBHOOK_URL", "http://localhost:5678/webhook/hr-scouting")

    # Extraer y descifrar datos si están cifrados en reposo, para que n8n reciba los valores claros
    extracted = document.extracted_data
    if isinstance(extracted, dict):
        clean_extracted = dict(extracted)
        if "_encrypted_data" in clean_extracted:
            decrypted = decrypt_sensitive_data(clean_extracted["_encrypted_data"])
            if isinstance(decrypted, dict):
                clean_extracted.update(decrypted)
            clean_extracted.pop("_encrypted_data", None)
        
        # Homogeneizar claves numéricas y de proveedores para facturas
        if "total" in clean_extracted and "monto_total" not in clean_extracted:
            clean_extracted["monto_total"] = clean_extracted["total"]
        if "monto_total" in clean_extracted and "total" not in clean_extracted:
            clean_extracted["total"] = clean_extracted["monto_total"]
        if "proveedor" in clean_extracted and "emisor_nombre" not in clean_extracted:
            clean_extracted["emisor_nombre"] = clean_extracted["proveedor"]
        if "emisor_nombre" in clean_extracted and "proveedor" not in clean_extracted:
            clean_extracted["proveedor"] = clean_extracted["emisor_nombre"]
        
        extracted = clean_extracted

    payload = {
        "tenant_id": document.tenant_id,
        "document_id": document.id,
        "filename": document.filename,
        "status": document.status,
        "category": document.category if document.category else None,
        "summary": document.summary if document.summary else None,
        "extracted_data": extracted if extracted else None,
        "error_message": document.error_log if document.status == "Error" else None,
    }

    # 1. Notificar al flujo general de notificaciones
    if webhook_url:
        try:
            with httpx.Client(timeout=5.0) as client:
                client.post(webhook_url, json=payload)
        except httpx.HTTPError as exc:
            logger.warning(
                "No se pudo notificar a n8n general para el documento %s: %s", document.id, exc
            )

    # 2. Si es Factura o Recibo, notificar también al flujo contable de aprobación
    is_accounting = document.category and any(k in document.category for k in ["Factura", "Recibo"])
    if invoice_webhook_url and is_accounting and document.status == "Procesado":
        try:
            with httpx.Client(timeout=5.0) as client:
                client.post(invoice_webhook_url, json=payload)
        except httpx.HTTPError as exc:
            logger.warning(
                "No se pudo notificar a n8n facturas para el documento %s: %s", document.id, exc
            )

    # 3. Si es Hoja de Vida / Perfil Laboral, notificar al flujo de Headhunter & Scouting
    is_hr = document.category and any(k in document.category for k in ["Hoja de Vida", "Perfiles Laborales", "Laboral", "Curriculum", "CV"])
    if hr_webhook_url and is_hr and document.status == "Procesado":
        try:
            with httpx.Client(timeout=5.0) as client:
                client.post(hr_webhook_url, json=payload)
        except httpx.HTTPError as exc:
            logger.warning(
                "No se pudo notificar a n8n HR scouting para el documento %s: %s", document.id, exc
            )
