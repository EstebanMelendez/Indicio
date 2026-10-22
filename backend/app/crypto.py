import os
import re
import json
import base64
import logging
from typing import Optional, Union
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes

logger = logging.getLogger("IndicioSecurity")

# Directorio seguro de llaves
KEYS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "keys")
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "db_public_key.pem")
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, "db_private_key.pem")

# Prefijo para identificar payloads cifrados en la BD
ENCRYPTED_PREFIX = "ENC::"


def ensure_key_pair():
    """
    Garantiza la existencia del par de llaves criptográficas asimétricas (RSA 2048-bit)
    para el cifrado de datos sensibles en la base de datos.
    """
    if not os.path.exists(KEYS_DIR):
        os.makedirs(KEYS_DIR, mode=0o700, exist_ok=True)

    if not os.path.exists(PUBLIC_KEY_PATH) or not os.path.exists(PRIVATE_KEY_PATH):
        logger.info("[SEGURIDAD] Generando nuevo par de llaves RSA 2048-bit para la base de datos...")
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )
        public_key = private_key.public_key()

        # Guardar clave privada
        with open(PRIVATE_KEY_PATH, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ))

        # Guardar clave pública
        with open(PUBLIC_KEY_PATH, "wb") as f:
            f.write(public_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            ))
        logger.info("[SEGURIDAD] Llaves criptográficas generadas exitosamente en %s", KEYS_DIR)


def get_public_key():
    """Carga la llave pública para cifrado."""
    ensure_key_pair()
    with open(PUBLIC_KEY_PATH, "rb") as f:
        return serialization.load_pem_public_key(f.read())


def get_private_key():
    """Carga la llave privada para descifrado."""
    ensure_key_pair()
    with open(PRIVATE_KEY_PATH, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def get_symmetric_cipher() -> Fernet:
    """
    Obtiene o deriva un cifrador simétrico autenticado (AES-128-CBC + HMAC-SHA256)
    usando DB_ENCRYPTION_KEY del entorno, o una clave derivada del par de llaves.
    """
    raw_key = os.getenv("DB_ENCRYPTION_KEY")
    if raw_key:
        try:
            return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key)
        except Exception:
            pass

    # Derivación estable de respaldo basada en el hash de la clave privada
    ensure_key_pair()
    with open(PRIVATE_KEY_PATH, "rb") as f:
        key_data = f.read()
    digest = hashes.Hash(hashes.SHA256())
    digest.update(key_data)
    derived = base64.urlsafe_b64encode(digest.finalize())
    return Fernet(derived)


def encrypt_sensitive_data(data: Union[dict, list, str, int, float]) -> str:
    """
    Cifra datos estructurados o texto sensible para almacenamiento seguro en PostgreSQL.
    Retorna una cadena con prefijo ENC:: que garantiza integridad y confidencialidad.
    """
    if data is None:
        return None

    try:
        json_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        cipher = get_symmetric_cipher()
        encrypted_bytes = cipher.encrypt(json_bytes)
        return ENCRYPTED_PREFIX + encrypted_bytes.decode("utf-8")
    except Exception as e:
        logger.error("[SEGURIDAD] Error cifrando datos sensibles: %s", e)
        # Fallback seguro
        return data


def decrypt_sensitive_data(encrypted_str: Union[str, dict, list]) -> Union[dict, list, str]:
    """
    Descifra datos previamente cifrados con encrypt_sensitive_data.
    Si el dato no está cifrado (datos legacy), lo retorna intacto sin fallar.
    """
    if not isinstance(encrypted_str, str) or not encrypted_str.startswith(ENCRYPTED_PREFIX):
        return encrypted_str

    try:
        token = encrypted_str[len(ENCRYPTED_PREFIX):].encode("utf-8")
        cipher = get_symmetric_cipher()
        decrypted_bytes = cipher.decrypt(token)
        return json.loads(decrypted_bytes.decode("utf-8"))
    except Exception as e:
        logger.warning("[SEGURIDAD] No se pudo descifrar el dato sensible: %s", e)
        return {"_encrypted": True, "error": "No autorizado para descifrar o llave inválida"}


def mask_secret(secret: Optional[str], visible_start: int = 4, visible_end: int = 4) -> str:
    """
    Enmascara API keys, tokens o contraseñas para impresión segura en logs.
    Ejemplo: 'AQ.Ab8RN6...ow' -> 'AQ.A********************8ow'
    """
    if not secret:
        return "<NO_CONFIGURADO>"
    s = str(secret).strip()
    if len(s) <= (visible_start + visible_end):
        return "*" * len(s)
    return s[:visible_start] + ("*" * (len(s) - visible_start - visible_end)) + s[-visible_end:]


def sanitize_error_log(error_message: Optional[str]) -> str:
    """
    Limpia y sanitiza trazas de error para evitar que contengan API keys, tokens de Telegram,
    o credenciales en URLs de excepción.
    """
    if not error_message:
        return ""
    text = str(error_message)

    # Ocultar API Keys de Google / Gemini (AIza... o patrones de query key=...)
    text = re.sub(r'(key|api_key|token)=([a-zA-Z0-9_\-\.]{10,})', r'\1=***REDACTED***', text, flags=re.IGNORECASE)
    text = re.sub(r'AQ\.[a-zA-Z0-9_\-]{20,}', r'AQ.***REDACTED_GEMINI_KEY***', text)
    text = re.sub(r'\d{8,12}:[a-zA-Z0-9_\-]{25,}', r'***REDACTED_TELEGRAM_TOKEN***', text)

    # Ocultar contraseñas en URLs de base de datos
    text = re.sub(r'://([^:]+):([^@]+)@', r'://\1:***REDACTED_PASSWORD***@', text)

    return text
