import logging
import os
import httpx
from app.models import Document

logger = logging.getLogger(__name__)

def notify_document_status(document: Document) -> None:
    webhook_url = os.getenv("N8N_WEBHOOK_URL")
    invoice_webhook_url = os.getenv("N8N_INVOICE_WEBHOOK_URL", "http://localhost:5678/webhook/invoice-approval")

    payload = {
        "tenant_id": document.tenant_id,
        "document_id": document.id,
        "filename": document.filename,
        "status": document.status,
        "category": document.category if document.category else None,
        "summary": document.summary if document.summary else None,
        "extracted_data": document.extracted_data if document.extracted_data else None,
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
