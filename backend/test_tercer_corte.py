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
from app.crypto import encrypt_sensitive_data, decrypt_sensitive_data, build_protected_extracted_data
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
    """Verifica el cifrado en reposo sin exposición de PII (Ley 1581) y la firma criptográfica HMAC de botones de correo."""
    sensitive_payload = {
        "emisor_nombre": "Clínica Sanitas S.A.",
        "emisor_nit": "800.251.440-6",
        "postulante": "Carlos Andrés Gómez",
        "monto_total": 1420000.0
    }
    protected_db_obj = build_protected_extracted_data(sensitive_payload)
    assert protected_db_obj["_ley1581_protected"] is True
    # Verificar que los datos personales (PII) NO quedan en texto plano en la raíz del JSONB
    assert "emisor_nit" not in protected_db_obj
    assert "postulante" not in protected_db_obj
    assert "***" in protected_db_obj["emisor_nit_masked"]
    assert "***" in protected_db_obj["postulante_masked"]

    encrypted_token = protected_db_obj["_encrypted_data"]
    assert isinstance(encrypted_token, str) and encrypted_token.startswith("ENC::")

    decrypted_payload = decrypt_sensitive_data(encrypted_token)
    assert decrypted_payload["emisor_nit"] == "800.251.440-6"
    assert decrypted_payload["postulante"] == "Carlos Andrés Gómez"
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


def test_08_multitenant_superadmin_and_company_admin_rbac():
    """
    Verifica:
    1) El control de acceso RBAC de require_role para 'superadmin', 'admin', 'auditor' y 'user'.
    2) El cifrado de contraseña del Superusuario (AdminEstebanM@gmail.com / zoan2006).
    3) Que un 'auditor' o 'user' reciba HTTP 403 al intentar acceder a la consola de Superusuario o a la pestaña de Usuarios de Admin.
    4) Validación estricta de campos: correo electrónico, longitud de contraseña (4 a 72 bytes) y sanitización anti-XSS en nombres de empresas/carpetas.
    """
    from fastapi import HTTPException
    from app.auth import get_password_hash, verify_password, require_role
    from app.models import User
    from main import _validate_and_clean_email, _validate_password, _sanitize_entity_name

    # 1. Verificar hash y validación de credenciales del Superusuario
    super_hash = get_password_hash("zoan2006")
    assert verify_password("zoan2006", super_hash) is True
    assert verify_password("clave_incorrecta", super_hash) is False

    super_user = User(id=1, email="AdminEstebanM@gmail.com", role="superadmin", tenant_id=1)
    admin_user = User(id=2, email="indicio.admin@gmail.com", role="admin", tenant_id=1)
    auditor_user = User(id=3, email="indicio.auditor@gmail.com", role="auditor", tenant_id=1)
    normal_user = User(id=4, email="indicio.user@gmail.com", role="user", tenant_id=1)

    check_superadmin = require_role(["superadmin"])
    check_company_admin = require_role(["admin"])

    # 2. Solo 'superadmin' puede acceder a la consola global Multi-Tenant
    assert check_superadmin(current_user=super_user) == super_user
    for unauthorized in (admin_user, auditor_user, normal_user):
        with pytest.raises(HTTPException) as exc_info:
            check_superadmin(current_user=unauthorized)
        assert exc_info.value.status_code == 403

    # 3. Solo 'admin' de la empresa puede acceder a la gestión de usuarios y auditores de su empresa
    assert check_company_admin(current_user=admin_user) == admin_user
    for unauthorized in (auditor_user, normal_user):
        with pytest.raises(HTTPException) as exc_info:
            check_company_admin(current_user=unauthorized)
        assert exc_info.value.status_code == 403

    # 4. Validaciones de campos y sanitización anti-XSS
    assert _validate_and_clean_email("  AdminEstebanM@gmail.com ") == "AdminEstebanM@gmail.com"
    for invalid_mail in ("correo_sin_arroba", "mal@", "@dominio.com", "<script>@evil.com"):
        with pytest.raises(HTTPException) as exc_mail:
            _validate_and_clean_email(invalid_mail)
        assert exc_mail.value.status_code == 400

    assert _validate_password("zoan2006") == "zoan2006"
    for invalid_pwd in ("123", "x" * 80):
        with pytest.raises(HTTPException) as exc_pwd:
            _validate_password(invalid_pwd)
        assert exc_pwd.value.status_code == 400

    assert _sanitize_entity_name("  Constructora <Bolívar> S.A.S. ") == "Constructora Bolívar S.A.S."
    with pytest.raises(HTTPException):
        _sanitize_entity_name("A")

    # 5. Verificar cifrado de Contraseña de Aplicación de Gmail por Empresa (Tenant)
    enc_gmail = encrypt_sensitive_data({"app_password": "abcd efgh ijkl mnop".replace(" ", "")})
    assert enc_gmail.startswith("ENC::")
    dec_gmail = decrypt_sensitive_data(enc_gmail)
    assert dec_gmail["app_password"] == "abcdefghijklmnop"





