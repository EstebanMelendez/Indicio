import os
import sys
import pytest
from fastapi.testclient import TestClient

# Asegurar que el directorio backend esté en sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app
from app.workflows.invoice_workflow import (
    node_validate_confidence,
    node_evaluate_amount,
    InvoiceState
)
from app.vision_service import is_image_file, _clean_number
from app.workflows.rag_agent import add_to_session_history, get_session_history
from app.crypto import encrypt_sensitive_data, decrypt_sensitive_data
from app.email_service import generate_email_action_token, verify_email_action_token

client = TestClient(app)


def _base_invoice_state(**overrides) -> InvoiceState:
    state: InvoiceState = {
        "tenant_id": 1,
        "document_id": 9999,
        "user_email": "test@indicio.internal",
        "trigger_source": "PytestSuite",
        "emisor_nit": "900.123.456-7",
        "numero_factura": "FAC-TEST-001",
        "emisor_nombre": "Proveedor Prueba SAS",
        "monto_total": 500000.0,
        "confidence_score": 95.0,
        "is_duplicate": False,
        "requires_human_review": False,
        "decision": "PENDIENTE",
        "target_folder": "Bandeja Entrada",
        "notes": "",
        "execution_time_ms": 0,
        "start_time": 0.0
    }
    state.update(overrides)
    return state


def test_01_langgraph_low_confidence_requires_human_review():
    """Verifica que una factura con confianza < 80% sea retenida para Revisión Humana (Human-in-the-Loop)."""
    state = _base_invoice_state(confidence_score=64.5)
    res = node_validate_confidence(state)
    assert res["requires_human_review"] is True
    assert res["decision"] == "REQUIERE_REVISION"
    assert res["target_folder"] == "Requiere Revisión"


def test_02_langgraph_auto_approval_under_one_million():
    """Verifica que una factura nítida (>= 80%) menor a $1.000.000 COP se apruebe automáticamente."""
    state = _base_invoice_state(confidence_score=94.0, monto_total=680000.0)
    conf_res = node_validate_confidence(state)
    assert conf_res["requires_human_review"] is False
    amt_res = node_evaluate_amount(state)
    assert amt_res["decision"] == "APROBADA_AUTOMATICA"
    assert amt_res["target_folder"] == "Facturas Aprobadas"


def test_03_langgraph_manager_approval_over_one_million():
    """Verifica que una factura >= $1.000.000 COP pase a Pendientes de Aprobación Gerencial."""
    state = _base_invoice_state(confidence_score=96.0, monto_total=1850000.0)
    amt_res = node_evaluate_amount(state)
    assert amt_res["decision"] == "PENDIENTE_APROBACION_GERENCIA"
    assert amt_res["target_folder"] == "Pendientes de Aprobación"


def test_04_vision_formats_and_colombian_currency_cleaning():
    """Verifica el soporte de formatos de cámara móvil y limpieza de montos en pesos colombianos."""
    assert is_image_file("foto_factura_celular.jpg") is True
    assert is_image_file("recibo_caja.PNG") is True
    assert is_image_file("captura_whatsapp.webp") is True
    assert is_image_file("contrato.pdf") is False

    assert _clean_number("$ 1.250.000,00 COP") == 1250000.0
    assert _clean_number("892,500") == 892500.0
    assert _clean_number(450000) == 450000.0


def test_05_langchain_conversational_memory_by_session():
    """Verifica que el agente RAG mantenga el historial de conversación por session_id."""
    session_id = "pytest_session_001"
    add_to_session_history(session_id, "¿Quién es Andrés Felipe?", "Andrés Felipe es un desarrollador Full Stack.")
    history = get_session_history(session_id)
    assert len(history) >= 2
    assert "Andrés Felipe" in history[-2].content
    assert "Full Stack" in history[-1].content


def test_06_security_ley1581_encryption_and_email_hmac():
    """Verifica el cifrado en reposo (Ley 1581) y la firma criptográfica HMAC de botones de correo."""
    sensitive_payload = {
        "emisor_nombre": "Clínica Sanitas S.A.",
        "emisor_nit": "800.251.440-6",
        "monto_total": 1420000.0
    }
    encrypted_token = encrypt_sensitive_data(sensitive_payload)
    assert isinstance(encrypted_token, str) and encrypted_token.startswith("ENC::")

    decrypted_payload = decrypt_sensitive_data(encrypted_token)
    assert decrypted_payload["emisor_nit"] == "800.251.440-6"
    assert decrypted_payload["monto_total"] == 1420000.0

    # Validar firma de enlaces interactivos de correo
    token = generate_email_action_token(27, "approve_invoice")
    assert verify_email_action_token(27, "approve_invoice", token) is True
    assert verify_email_action_token(27, "reject_invoice", token) is False


def test_07_plan_b_fallback_configuration():
    """Verifica que el módulo Plan B (Groq API + Contingencia Local) esté operativo."""
    from app.fallback_service import build_emergency_vision_fallback
    import json

    raw_json, provider = build_emergency_vision_fallback("factura_borrosa.jpg", 1080, 1920)
    parsed = json.loads(raw_json)
    assert provider == "PlanB-LocalContingency"
    assert parsed["extracted_data"]["confidence_score"] < 80.0

