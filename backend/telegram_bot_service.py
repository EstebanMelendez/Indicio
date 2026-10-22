import os
import time
import json
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

# Enmascarar token en logs para seguridad
masked_token = BOT_TOKEN[:6] + "..." + BOT_TOKEN[-4:] if len(BOT_TOKEN) > 10 else "***"
logger.info(f"Iniciando servicio de Telegram Bot con token seguro: {masked_token}")

N8N_WEBHOOK = os.getenv("N8N_TELEGRAM_RAG_WEBHOOK_URL", "http://localhost:5678/webhook/telegram-rag")
TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

WELCOME_MESSAGE = """👋 *¡Hola! Soy el Asistente RAG de DocuMind (Indicio Enterprise).*

Tengo acceso seguro y en tiempo real a toda la base de conocimiento y documentos procesados:

💼 *Hojas de Vida:* Experiencia, candidatos, competencias técnicas y postulaciones.
📄 *Facturas:* Montos, proveedores, estado de aprobación y vencimientos.
⚖️ *Contratos:* Cláusulas, vigencias y acuerdos comerciales.

💡 *Pruébame haciéndome cualquier pregunta:*
• _"¿Qué candidatos tenemos con experiencia en React?"_
• _"¿Cuál es el valor y proveedor de las facturas procesadas?"_
• _"¿Quién es Laura Martínez y qué perfil tiene?"_

¡Escribe tu pregunta a continuación! 🚀"""

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
    # Si falla por error de formato markdown, reintentar en texto plano
    if not res.get("ok"):
        payload.pop("parse_mode", None)
        send_telegram_request("sendMessage", payload)

def query_rag_via_n8n(chat_id: int, user_name: str, query: str) -> str:
    payload = json.dumps({
        "chat_id": chat_id,
        "user_name": user_name,
        "query": query
    }).encode("utf-8")
    
    req = urllib.request.Request(
        N8N_WEBHOOK,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("text") or "No se pudo obtener una respuesta formateada."
    except Exception as e:
        logger.warning(f"Error consultando n8n webhook: {e}. Intentando fallback directo a FastAPI...")
        return query_rag_fallback(query)

def query_rag_fallback(query: str) -> str:
    """Fallback directo a FastAPI si n8n no responde"""
    try:
        service_pwd = os.getenv("N8N_SERVICE_PASSWORD")
        if not service_pwd:
            logger.error("N8N_SERVICE_PASSWORD no configurado en .env para fallback directo")
            return "El servicio temporalmente no puede procesar consultas. Contacte al administrador."

        # 1. Login
        login_data = json.dumps({
            "email": "n8n.service@gmail.com",
            "password": service_pwd
        }).encode("utf-8")
        req_auth = urllib.request.Request(
            "http://127.0.0.1:8000/api/auth/login",
            data=login_data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_auth, timeout=10) as r:
            token = json.loads(r.read())["access_token"]

        # 2. Query RAG
        rag_data = json.dumps({"query": query}).encode("utf-8")
        req_rag = urllib.request.Request(
            "http://127.0.0.1:8000/api/rag/query",
            data=rag_data,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_rag, timeout=30) as r:
            res = json.loads(r.read().decode("utf-8"))
            ans = res.get("answer", "")
            srcs = res.get("sources", [])
            sources_txt = f"\n\n📚 *Fuentes consultadas:*\n" + "\n".join([f"• 📄 `{s}`" for s in srcs]) if srcs else ""
            return f"🧠 *DocuMind RAG Assistant*\n\n{ans}{sources_txt}"
    except Exception as exc:
        logger.error(f"Error en fallback RAG directo: {exc}")
        return "⚠️ Lo siento, ocurrió un error temporal al procesar tu consulta en la base de conocimiento."

def run_bot():
    logger.info("==================================================")
    logger.info("🤖 DocuMind Telegram RAG Bot Iniciado Exitosamente")
    logger.info("Bot conectado a @Indicion8n_bot")
    logger.info("Orquestador: n8n (/webhook/telegram-rag)")
    logger.info("Motor IA: FastAPI + pgvector (768d) + Gemini")
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
                if not msg or "text" not in msg:
                    continue

                chat_id = msg["chat"]["id"]
                user_name = msg.get("from", {}).get("first_name", "Colega")
                text = msg["text"].strip()

                logger.info(f"Mensaje de [{user_name}] ({chat_id}): '{text}'")

                if text in ["/start", "/ayuda", "/help"]:
                    send_message(chat_id, WELCOME_MESSAGE)
                    continue

                # Notificar al usuario que la IA está pensando
                send_chat_action(chat_id, "typing")

                # Consultar al flujo n8n
                answer = query_rag_via_n8n(chat_id, user_name, text)

                # Enviar respuesta formateada
                send_message(chat_id, answer)

        except urllib.error.URLError as e:
            time.sleep(3)
        except Exception as e:
            logger.error(f"Error en loop de polling: {e}")
            time.sleep(3)

if __name__ == "__main__":
    run_bot()
