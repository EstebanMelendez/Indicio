import os
import re
import time
import json
import uuid
import logging
import threading
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("DocuMind-Telegram")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"
TELEGRAM_FILE_BASE = f"https://api.telegram.org/file/bot{BOT_TOKEN}"
BACKEND_BASE_URL = f"http://127.0.0.1:{os.getenv('PORT', '8000')}/api"


def build_welcome_message(tenant_name: str = "Indicio Enterprise") -> str:
    return f"""👋 *¡Hola! Soy el Asistente Inteligente de {tenant_name} (DocuMind).*

🏢 *Repositorio Empresarial Aislado Activo*
Puedo ayudarte de dos formas en tu organización:

📸 *1. Visión por Computador (Cuentas por Pagar):*
Envíame una *foto de una factura o recibo* tomada con tu celular y extraeré automáticamente:
• Proveedor, NIT, Número de factura y Fecha
• Detalle de productos/servicios e importe total
• Nivel de confianza IA y decisión contable automática

🧠 *2. Consultas RAG con Memoria Conversacional (LangChain):*
Pregúntame cualquier cosa sobre las facturas, contratos u hojas de vida de *{tenant_name}*:
• _"¿Qué candidatos tenemos con experiencia en React?"_
• _"¿Cuál es el valor y proveedor de las facturas procesadas?"_
• _"¿Y qué habilidades tiene el primero?"_ (¡Recuerdo el contexto!)

¡Envíame una foto de factura o escribe tu pregunta! 🚀"""


WELCOME_MESSAGE = build_welcome_message("Indicio Enterprise")


def mask_bot_token(token: str) -> str:
    clean = (token or "").strip()
    if not clean:
        return ""
    if len(clean) <= 12:
        return "****"
    return f"{clean[:6]}...{clean[-4:]}"


def verify_telegram_bot_token(bot_token: str) -> dict:
    """
    Valida en tiempo real con la API oficial de Telegram (getMe) si el token
    entregado por @BotFather es válido y retorna el @username del bot.
    """
    clean_token = (bot_token or "").strip()
    if not clean_token or ":" not in clean_token or len(clean_token) < 20:
        return {
            "valid": False,
            "reason": "El formato del token de Telegram no es válido. Debe tener el formato entregado por @BotFather (ej. 123456789:ABCdef...)."
        }

    url = f"https://api.telegram.org/bot{clean_token}/getMe"
    req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok") and isinstance(data.get("result"), dict):
                bot_info = data["result"]
                uname = bot_info.get("username", "")
                first_name = bot_info.get("first_name", "Bot")
                return {
                    "valid": True,
                    "username": f"@{uname}" if uname and not uname.startswith("@") else uname,
                    "first_name": first_name,
                    "bot_id": bot_info.get("id")
                }
            return {"valid": False, "reason": "Telegram rechazó el token proporcionado."}
    except urllib.error.HTTPError as http_err:
        if http_err.code in (401, 404):
            return {"valid": False, "reason": "Token de Bot inválido o revocado en @BotFather (Error 401 Unauthorized)."}
        return {"valid": False, "reason": f"Error HTTP {http_err.code} al verificar con Telegram."}
    except Exception as exc:
        return {"valid": False, "reason": f"No fue posible conectar con api.telegram.org: {str(exc)[:100]}"}


def get_tenant_telegram_config(db, tenant_id: int) -> dict:
    """
    Obtiene la configuración de Bot de Telegram enlazada a una empresa (Tenant).
    - Descifra `telegram_bot_token_enc` protegido con AES-128 + RSA-2048 (ENC::).
    - Si es el Tenant #1 y aún no tiene token propio en BD, hereda TELEGRAM_BOT_TOKEN de .env.
    """
    from app.models import Tenant
    from app.crypto import decrypt_sensitive_data

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first() if db else None
    tenant_name = tenant.name if tenant else f"Empresa #{tenant_id}"

    bot_token = ""
    bot_username = ""

    if tenant:
        bot_username = (getattr(tenant, "telegram_bot_username", None) or "").strip()
        enc_val = getattr(tenant, "telegram_bot_token_enc", None)
        if enc_val:
            decrypted = decrypt_sensitive_data(enc_val)
            if isinstance(decrypted, dict):
                bot_token = (decrypted.get("bot_token") or "").strip()
            elif isinstance(decrypted, str) and not decrypted.startswith("ENC::"):
                bot_token = decrypted.strip()

    # Fallback automático para Organización Principal (Tenant #1)
    if tenant_id == 1 and not bot_token:
        env_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if env_token:
            bot_token = env_token
            if not bot_username:
                bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "@Indicion8n_bot").strip()

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "storage_path": f"storage/tenant_{tenant_id}",
        "bot_token": bot_token,
        "bot_username": bot_username or None,
        "has_bot_token": bool(bot_token),
        "bot_token_masked": mask_bot_token(bot_token)
    }


def send_telegram_request(endpoint: str, payload: dict, bot_token: str = None) -> dict:
    active_token = (bot_token or BOT_TOKEN or os.getenv("TELEGRAM_BOT_TOKEN", "")).strip()
    url = f"https://api.telegram.org/bot{active_token}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error(f"Error en llamada a Telegram API ({endpoint}): {e}")
        return {}


def send_chat_action(chat_id: int, action: str = "typing", bot_token: str = None):
    send_telegram_request("sendChatAction", {"chat_id": chat_id, "action": action}, bot_token=bot_token)


def send_message(chat_id: int, text: str, parse_mode: str = "Markdown", bot_token: str = None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    res = send_telegram_request("sendMessage", payload, bot_token=bot_token)
    if not res.get("ok"):
        payload.pop("parse_mode", None)
        send_telegram_request("sendMessage", payload, bot_token=bot_token)


def get_backend_token(tenant_id: int = 1) -> str:
    """
    Genera un token JWT estrictamente aislado para la empresa (`tenant_id`) dueña del Bot.
    Así cada foto subida o consulta RAG hecha en el bot de una empresa opera únicamente
    sobre su propio repositorio (`storage/tenant_{tenant_id}/`).
    """
    try:
        from app.database import SessionLocal
        from app.models import User
        from app.auth import create_access_token

        db = SessionLocal()
        try:
            # Buscar primero el administrador o usuario operativo de esa empresa
            user = (
                db.query(User)
                .filter(User.tenant_id == tenant_id, User.role.in_(["admin", "service", "user"]))
                .order_by(User.id.asc())
                .first()
            )
            if user:
                return create_access_token(
                    data={
                        "sub": user.email,
                        "role": user.role if user.role in ["admin", "service", "user"] else "admin",
                        "tenant_id": tenant_id
                    }
                )
        finally:
            db.close()
    except Exception:
        pass

    # Fallback HTTP para ejecución standalone en Tenant #1
    service_pwd = os.getenv("N8N_SERVICE_PASSWORD", "n8n_secure_pwd_2026_xyz")
    login_data = json.dumps({
        "email": "n8n.service@gmail.com",
        "password": service_pwd
    }).encode("utf-8")
    req_auth = urllib.request.Request(
        f"{BACKEND_BASE_URL}/auth/login",
        data=login_data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_auth, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def query_rag_fallback(query: str, chat_id: int = 0, tenant_id: int = 1, tenant_name: str = "") -> str:
    """Consulta directa a FastAPI (motor LangChain con memoria aislada por empresa y chat_id)"""
    try:
        token = get_backend_token(tenant_id=tenant_id)
        session_id = f"telegram_t{tenant_id}_{chat_id}" if chat_id else f"telegram_t{tenant_id}_general"
        rag_data = json.dumps({
            "query": query,
            "session_id": session_id
        }).encode("utf-8")
        req_rag = urllib.request.Request(
            f"{BACKEND_BASE_URL}/rag/query",
            data=rag_data,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_rag, timeout=40) as r:
            res = json.loads(r.read().decode("utf-8"))
            ans = res.get("answer", "")
            srcs = res.get("sources", [])
            sources_txt = f"\n\n📚 *Fuentes consultadas ({tenant_name or f'Tenant #{tenant_id}'}):*\n" + "\n".join([f"• 📄 `{s}`" for s in srcs]) if srcs else ""
            header_org = f" — *{tenant_name}*" if tenant_name else ""
            return f"🧠 *DocuMind RAG Assistant{header_org}*\n\n{ans}{sources_txt}"
    except Exception as exc:
        logger.error(f"Error en consulta RAG (Tenant #{tenant_id}): {exc}")
        return "⚠️ Lo siento, ocurrió un error temporal al procesar tu consulta en la base de conocimiento de tu empresa."


def process_telegram_photo(
    chat_id: int,
    user_name: str,
    file_id: str,
    custom_filename: str = None,
    bot_token: str = None,
    tenant_id: int = 1,
    tenant_name: str = ""
) -> str:
    """
    Descarga la foto enviada por el Bot de la empresa, la sube al endpoint /api/documents/upload
    autenticada con el token de esa empresa (`tenant_id`) hacia `storage/tenant_{tenant_id}/`
    y retorna el resultado del análisis con Visión Computacional + LangGraph.
    """
    active_bot_token = (bot_token or BOT_TOKEN or os.getenv("TELEGRAM_BOT_TOKEN", "")).strip()
    try:
        # 1. Obtener file_path en Telegram usando el token de la empresa correspondiente
        file_info = send_telegram_request("getFile", {"file_id": file_id}, bot_token=active_bot_token)
        if not file_info.get("ok"):
            return "⚠️ No pude descargar la imagen desde Telegram."

        tg_file_path = file_info["result"]["file_path"]
        ext = os.path.splitext(tg_file_path)[1].lower() or ".jpg"
        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            ext = ".jpg"

        filename = custom_filename or f"factura_telegram_t{tenant_id}_{int(time.time())}{ext}"
        download_url = f"https://api.telegram.org/file/bot{active_bot_token}/{tg_file_path}"

        with urllib.request.urlopen(download_url, timeout=20) as resp:
            image_bytes = resp.read()

        # 2. Subir imagen a FastAPI mediante multipart/form-data en el repositorio de la empresa
        token = get_backend_token(tenant_id=tenant_id)
        boundary = f"----DocuMindBoundary{uuid.uuid4().hex}"
        mime_type = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8") + image_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req_upload = urllib.request.Request(
            f"{BACKEND_BASE_URL}/documents/upload",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}"
            }
        )
        with urllib.request.urlopen(req_upload, timeout=20) as r:
            upload_res = json.loads(r.read().decode("utf-8"))
            doc_id = upload_res["id"]

        # 3. Esperar a que termine el procesamiento de Visión + LangGraph (máx ~28s)
        doc_data = None
        for _ in range(14):
            time.sleep(2)
            req_doc = urllib.request.Request(
                f"{BACKEND_BASE_URL}/documents/{doc_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
            with urllib.request.urlopen(req_doc, timeout=10) as r:
                doc_data = json.loads(r.read().decode("utf-8"))
                if doc_data.get("status") not in ["Pendiente", "Procesando"]:
                    break

        if not doc_data:
            return "⚠️ La factura fue recibida pero sigue procesándose en segundo plano."

        status = doc_data.get("status", "Procesado")
        if status == "Error":
            return f"❌ Error procesando la imagen: {doc_data.get('error_log', 'Imagen ilegible')}"

        ext_data = doc_data.get("extracted_data") or {}
        emisor = ext_data.get("emisor_nombre") or ext_data.get("proveedor") or "No detectado"
        nit = ext_data.get("emisor_nit") or "N/A"
        num_fac = ext_data.get("numero_factura") or "S/N"
        fecha = ext_data.get("fecha_emision") or "No detectada"
        moneda = ext_data.get("moneda") or "COP"
        total = float(ext_data.get("monto_total") or ext_data.get("total") or 0)
        conf = float(ext_data.get("confidence_score") or 90)
        estado_contable = ext_data.get("estado_contable") or status
        items = ext_data.get("items") or []

        items_lines = ""
        if items:
            items_lines = "\n📦 *Ítems detectados:*\n" + "\n".join(
                [f"• {it.get('descripcion', 'Ítem')} (x{it.get('cantidad', 1)}): ${float(it.get('subtotal', 0)):,.0f}" for it in items[:5]]
            )

        review_note = ""
        if conf < 80 or status == "Requiere Revisión":
            review_note = (
                f"\n\n⚠️ *VALIDACIÓN HUMANA REQUERIDA:*\n"
                f"La confianza de lectura ({conf:.0f}%) es inferior al 80%. "
                f"Por favor revisa y confirma los datos en el Repositorio Web antes de contabilizar."
            )

        org_line = f"🏛️ *Empresa:* {tenant_name} (`storage/tenant_{tenant_id}/`)\n" if tenant_name else ""
        return (
            f"📸 *Factura Procesada con Visión Computacional*\n\n"
            f"{org_line}"
            f"🏢 *Proveedor:* {emisor}\n"
            f"🆔 *NIT:* {nit}\n"
            f"🧾 *N° Factura:* {num_fac}\n"
            f"📅 *Fecha:* {fecha}\n"
            f"💰 *Monto Total:* ${total:,.2f} {moneda}\n"
            f"🎯 *Confianza IA:* {conf:.0f}%\n"
            f"⚖️ *Estado Contable:* {estado_contable}"
            f"{items_lines}"
            f"{review_note}"
        )

    except Exception as e:
        logger.error(f"Error procesando foto de Telegram (Tenant #{tenant_id}): {e}")
        return f"⚠️ Ocurrió un error al analizar la foto de la factura: {str(e)[:120]}"


def _poll_single_tenant_bot(tenant_id: int, tenant_name: str, bot_token: str, stop_event: threading.Event):
    """
    Hilo de polling dedicado para el Bot de Telegram de una empresa específica (`tenant_id`).
    Se detiene limpiamente si el Administrador de la empresa actualiza o desvincula su token.
    """
    masked = mask_bot_token(bot_token)
    logger.info(f"🤖 [TELEGRAM MULTI-TENANT] Bot iniciado para '{tenant_name}' (Tenant #{tenant_id} | Token: {masked})")
    offset = 0

    while not stop_event.is_set():
        try:
            url = f"https://api.telegram.org/bot{bot_token}/getUpdates?offset={offset}&timeout=15"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=22) as resp:
                updates = json.loads(resp.read().decode("utf-8")).get("result", [])

            for u in updates:
                if stop_event.is_set():
                    break
                offset = u["update_id"] + 1
                msg = u.get("message")
                if not msg:
                    continue

                chat_id = msg["chat"]["id"]
                user_name = msg.get("from", {}).get("first_name", "Colega")

                # Caso 1: El usuario envió una FOTO de factura/recibo
                if "photo" in msg and msg["photo"]:
                    highest_res_photo = msg["photo"][-1]
                    file_id = highest_res_photo["file_id"]
                    logger.info(f"📸 [Tenant #{tenant_id}: {tenant_name}] Foto recibida de [{user_name}] ({chat_id})")
                    send_message(
                        chat_id,
                        f"📸 *Recibí la foto de tu factura en {tenant_name}.* Analizando imagen con Visión Computacional y verificando en tu repositorio...",
                        bot_token=bot_token
                    )
                    send_chat_action(chat_id, "typing", bot_token=bot_token)
                    reply = process_telegram_photo(
                        chat_id,
                        user_name,
                        file_id,
                        bot_token=bot_token,
                        tenant_id=tenant_id,
                        tenant_name=tenant_name
                    )
                    send_message(chat_id, reply, bot_token=bot_token)
                    continue

                # Caso 2: El usuario envió una imagen como documento adjunto
                if "document" in msg and msg["document"]:
                    doc_mime = msg["document"].get("mime_type", "")
                    doc_fname = msg["document"].get("file_name", "imagen.jpg")
                    if doc_mime.startswith("image/"):
                        file_id = msg["document"]["file_id"]
                        logger.info(f"🖼️ [Tenant #{tenant_id}: {tenant_name}] Imagen adjunta de [{user_name}]: {doc_fname}")
                        send_message(
                            chat_id,
                            f"📸 *Recibí el archivo `{doc_fname}` en {tenant_name}.* Extrayendo datos con Visión Computacional...",
                            bot_token=bot_token
                        )
                        send_chat_action(chat_id, "typing", bot_token=bot_token)
                        reply = process_telegram_photo(
                            chat_id,
                            user_name,
                            file_id,
                            custom_filename=doc_fname,
                            bot_token=bot_token,
                            tenant_id=tenant_id,
                            tenant_name=tenant_name
                        )
                        send_message(chat_id, reply, bot_token=bot_token)
                        continue

                # Caso 3: Mensaje de texto (RAG con Memoria LangChain aislada por empresa)
                if "text" in msg:
                    text = msg["text"].strip()
                    logger.info(f"💬 [Tenant #{tenant_id}: {tenant_name}] Mensaje de [{user_name}] ({chat_id}): '{text}'")

                    if text in ["/start", "/ayuda", "/help"]:
                        send_message(chat_id, build_welcome_message(tenant_name), bot_token=bot_token)
                        continue

                    send_chat_action(chat_id, "typing", bot_token=bot_token)
                    answer = query_rag_fallback(text, chat_id, tenant_id=tenant_id, tenant_name=tenant_name)
                    send_message(chat_id, answer, bot_token=bot_token)

        except urllib.error.HTTPError as http_err:
            if http_err.code in (401, 404, 409):
                logger.warning(f"⚠️ [TELEGRAM Tenant #{tenant_id}] Error HTTP {http_err.code} en polling. Esperando 10s...")
                time.sleep(10)
            else:
                time.sleep(4)
        except urllib.error.URLError:
            time.sleep(4)
        except Exception as e:
            logger.error(f"Error en loop de polling (Tenant #{tenant_id}): {e}")
            time.sleep(4)

    logger.info(f"🛑 [TELEGRAM MULTI-TENANT] Bot detenido para '{tenant_name}' (Tenant #{tenant_id})")


def _load_configured_tenant_bots() -> dict:
    """
    Consulta en PostgreSQL todas las empresas (Tenants) que tienen un token de Bot de Telegram enlazado.
    Retorna un diccionario: {tenant_id: {"name": str, "token": str}}
    """
    bots = {}
    try:
        from app.database import SessionLocal
        from app.models import Tenant

        db = SessionLocal()
        try:
            tenants = db.query(Tenant).order_by(Tenant.id.asc()).all()
            seen_tokens = set()
            for t in tenants:
                cfg = get_tenant_telegram_config(db, t.id)
                tok = (cfg.get("bot_token") or "").strip()
                if tok and tok not in seen_tokens:
                    seen_tokens.add(tok)
                    bots[t.id] = {
                        "name": t.name,
                        "token": tok
                    }
        finally:
            db.close()
    except Exception:
        env_tok = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if env_tok:
            bots[1] = {"name": "Organización Principal", "token": env_tok}
    return bots


def run_bot():
    """
    Orquestador Multi-Tenant de Bots de Telegram:
    Supervisa dinámicamente todas las empresas registradas en PostgreSQL y mantiene
    un hilo de escucha independiente para el Bot de cada empresa, recargando en caliente
    cuando un Administrador enlaza o cambia su token desde la interfaz Web.
    """
    global BOT_TOKEN, TELEGRAM_API_BASE, TELEGRAM_FILE_BASE, BACKEND_BASE_URL
    BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"
    TELEGRAM_FILE_BASE = f"https://api.telegram.org/file/bot{BOT_TOKEN}"
    BACKEND_BASE_URL = f"http://127.0.0.1:{os.getenv('PORT', '8000')}/api"

    logger.info("==========================================================")
    logger.info("🤖 Orquestador Multi-Tenant de Bots de Telegram Iniciado")
    logger.info(f"Backend API: {BACKEND_BASE_URL}")
    logger.info("Cada empresa opera con su propio Bot hacia storage/tenant_{id}/")
    logger.info("==========================================================")

    # Registro de hilos activos por empresa: {tenant_id: {"token": str, "stop_event": Event, "thread": Thread}}
    active_workers = {}

    while True:
        try:
            desired_bots = _load_configured_tenant_bots()

            # 1. Detener bots de empresas cuyo token fue eliminado o modificado
            for t_id in list(active_workers.keys()):
                current_worker = active_workers[t_id]
                new_cfg = desired_bots.get(t_id)
                if not new_cfg or new_cfg["token"] != current_worker["token"] or not current_worker["thread"].is_alive():
                    current_worker["stop_event"].set()
                    del active_workers[t_id]

            # 2. Iniciar hilos para empresas con Bot nuevo o actualizado
            for t_id, cfg in desired_bots.items():
                if t_id not in active_workers:
                    stop_ev = threading.Event()
                    th = threading.Thread(
                        target=_poll_single_tenant_bot,
                        args=(t_id, cfg["name"], cfg["token"], stop_ev),
                        daemon=True,
                        name=f"TelegramBot-Tenant-{t_id}"
                    )
                    active_workers[t_id] = {
                        "token": cfg["token"],
                        "stop_event": stop_ev,
                        "thread": th
                    }
                    th.start()

        except Exception as mgr_err:
            logger.error(f"Error en orquestador Multi-Tenant de Telegram: {mgr_err}")

        time.sleep(10)


if __name__ == "__main__":
    run_bot()
