import os
import time
import json
import uuid
import logging
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("DocuMind-Telegram")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN no está configurado en las variables de entorno (.env)")
    raise ValueError("TELEGRAM_BOT_TOKEN no configurado en el archivo .env")

masked_token = BOT_TOKEN[:6] + "..." + BOT_TOKEN[-4:] if len(BOT_TOKEN) > 10 else "***"
logger.info(f"Iniciando servicio de Telegram Bot con token seguro: {masked_token}")

TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"
TELEGRAM_FILE_BASE = f"https://api.telegram.org/file/bot{BOT_TOKEN}"
BACKEND_BASE_URL = "http://127.0.0.1:8000/api"

WELCOME_MESSAGE = """👋 *¡Hola! Soy el Asistente Inteligente de DocuMind (Indicio Enterprise).*

Puedo ayudarte de dos formas:

📸 *1. Visión por Computador (Cuentas por Pagar):*
Envíame una *foto de una factura o recibo* tomada con tu celular y extraeré automáticamente:
• Proveedor, NIT, Número de factura y Fecha
• Detalle de productos/servicios e importe total
• Nivel de confianza IA y decisión contable automática

🧠 *2. Consultas RAG con Memoria Conversacional (LangChain):*
Pregúntame cualquier cosa sobre las facturas, contratos u hojas de vida:
• _"¿Qué candidatos tenemos con experiencia en React?"_
• _"¿Cuál es el valor y proveedor de las facturas procesadas?"_
• _"¿Y qué habilidades tiene el primero?"_ (¡Recuerdo el contexto!)

¡Envíame una foto de factura o escribe tu pregunta! 🚀"""


def send_telegram_request(endpoint: str, payload: dict) -> dict:
    url = f"{TELEGRAM_API_BASE}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error(f"Error en llamada a Telegram API ({endpoint}): {e}")
        return {}


def send_chat_action(chat_id: int, action: str = "typing"):
    send_telegram_request("sendChatAction", {"chat_id": chat_id, "action": action})


def send_message(chat_id: int, text: str, parse_mode: str = "Markdown"):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    res = send_telegram_request("sendMessage", payload)
    if not res.get("ok"):
        payload.pop("parse_mode", None)
        send_telegram_request("sendMessage", payload)


def get_backend_token() -> str:
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


def query_rag_fallback(query: str, chat_id: int = 0) -> str:
    """Consulta directa a FastAPI (motor LangChain con memoria por chat_id)"""
    try:
        token = get_backend_token()
        session_id = f"telegram_{chat_id}" if chat_id else "telegram_general"
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
            sources_txt = f"\n\n📚 *Fuentes consultadas:*\n" + "\n".join([f"• 📄 `{s}`" for s in srcs]) if srcs else ""
            return f"🧠 *DocuMind RAG Assistant (LangChain)*\n\n{ans}{sources_txt}"
    except Exception as exc:
        logger.error(f"Error en consulta RAG: {exc}")
        return "⚠️ Lo siento, ocurrió un error temporal al procesar tu consulta en la base de conocimiento."


def process_telegram_photo(chat_id: int, user_name: str, file_id: str, custom_filename: str = None) -> str:
    """
    Descarga la foto enviada por Telegram, la sube al endpoint /api/documents/upload
    de FastAPI para su análisis con Visión Computacional + LangGraph y retorna el resultado.
    """
    try:
        # 1. Obtener file_path en Telegram
        file_info = send_telegram_request("getFile", {"file_id": file_id})
        if not file_info.get("ok"):
            return "⚠️ No pude descargar la imagen desde Telegram."

        tg_file_path = file_info["result"]["file_path"]
        ext = os.path.splitext(tg_file_path)[1].lower() or ".jpg"
        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            ext = ".jpg"

        filename = custom_filename or f"factura_telegram_{int(time.time())}{ext}"
        download_url = f"{TELEGRAM_FILE_BASE}/{tg_file_path}"

        with urllib.request.urlopen(download_url, timeout=20) as resp:
            image_bytes = resp.read()

        # 2. Subir imagen a FastAPI mediante multipart/form-data
        token = get_backend_token()
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

        return (
            f"📸 *Factura Procesada con Visión Computacional*\n\n"
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
        logger.error(f"Error procesando foto de Telegram: {e}")
        return f"⚠️ Ocurrió un error al analizar la foto de la factura: {str(e)[:120]}"


def run_bot():
    logger.info("==================================================")
    logger.info("🤖 DocuMind Telegram Bot (RAG + Visión Facturas)")
    logger.info("Bot conectado a @Indicion8n_bot")
    logger.info("Motor IA: FastAPI + LangChain + LangGraph + Gemini Vision")
    logger.info("==================================================")

    offset = 0
    while True:
        try:
            url = f"{TELEGRAM_API_BASE}/getUpdates?offset={offset}&timeout=20"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                updates = json.loads(resp.read().decode("utf-8")).get("result", [])

            for u in updates:
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
                    logger.info(f"📸 Foto recibida de [{user_name}] ({chat_id}) -> file_id={file_id[:16]}...")
                    send_message(chat_id, "📸 *Recibí la foto de tu factura.* Analizando imagen con Visión Computacional y verificando en PostgreSQL...")
                    send_chat_action(chat_id, "typing")
                    reply = process_telegram_photo(chat_id, user_name, file_id)
                    send_message(chat_id, reply)
                    continue

                # Caso 2: El usuario envió una imagen como documento adjunto
                if "document" in msg and msg["document"]:
                    doc_mime = msg["document"].get("mime_type", "")
                    doc_fname = msg["document"].get("file_name", "imagen.jpg")
                    if doc_mime.startswith("image/"):
                        file_id = msg["document"]["file_id"]
                        logger.info(f"🖼️ Imagen adjunta recibida de [{user_name}] ({chat_id}): {doc_fname}")
                        send_message(chat_id, f"📸 *Recibí el archivo `{doc_fname}`.* Extrayendo datos con Visión Computacional...")
                        send_chat_action(chat_id, "typing")
                        reply = process_telegram_photo(chat_id, user_name, file_id, custom_filename=doc_fname)
                        send_message(chat_id, reply)
                        continue

                # Caso 3: Mensaje de texto (RAG con Memoria LangChain)
                if "text" in msg:
                    text = msg["text"].strip()
                    logger.info(f"💬 Mensaje de [{user_name}] ({chat_id}): '{text}'")

                    if text in ["/start", "/ayuda", "/help"]:
                        send_message(chat_id, WELCOME_MESSAGE)
                        continue

                    send_chat_action(chat_id, "typing")
                    answer = query_rag_fallback(text, chat_id)
                    send_message(chat_id, answer)

        except urllib.error.URLError:
            time.sleep(3)
        except Exception as e:
            logger.error(f"Error en loop de polling: {e}")
            time.sleep(3)


if __name__ == "__main__":
    run_bot()
