import logging
import os
import httpx
from app.models import Document

logger = logging.getLogger(__name__)

def notify_document_status(document: Document) -> None:
    webhook_url = os.getenv("N8N_WEBHOOK_URL")
    if not webhook_url:
        return  # integración no configurada todavía — no-op silencioso

    payload = {
        "tenant_id": document.tenant_id,
        "document_id": document.id,
        "filename": document.filename,
        "status": document.status,
        "category": document.category if document.category else None,
        "extracted_data": document.extracted_data if document.extracted_data else None,
        "error_message": document.error_log if document.status == "Error" else None,
    }

    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(webhook_url, json=payload)
    except httpx.HTTPError as exc:
        # Una falla notificando NO debe tumbar el pipeline de procesamiento
        logger.warning(
            "No se pudo notificar a n8n para el documento %s: %s", document.id, exc
        )
