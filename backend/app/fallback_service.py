import os
import re
import json
import base64
import logging
from io import BytesIO
from typing import Dict, Any, Optional, Tuple
import httpx
from PIL import Image

logger = logging.getLogger("IndicioPlanB")

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

GROQ_TEXT_MODELS = [
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b"
]

GROQ_VISION_MODELS = [
    "qwen/qwen3.8-27b"
]


def _clean_reasoning_output(text: str, json_mode: bool = False) -> str:
    """Elimina bloques <think>...</think> o delimitadores markdown de modelos razonadores."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:-3].strip()
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:-3].strip()
    if json_mode and "{" in cleaned and "}" in cleaned:
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        cleaned = cleaned[start:end]
    return cleaned


def call_groq_text(prompt: str, json_mode: bool = False) -> Tuple[Optional[str], Optional[str]]:
    """
    Plan B (Capa 1): Invoca Groq Cloud API gratuita (Llama 3.3 70B / 3.1 8B) cuando Google Gemini
    presenta error 429 (Quota Exceeded) o 503 (Service Unavailable).
    Retorna (respuesta_texto, nombre_proveedor_usado).
    """
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        logger.warning("[PLAN B] GROQ_API_KEY no configurada en backend/.env.")
        return None, None

    headers = {
        "Authorization": f"Bearer {groq_key}",
        "Content-Type": "application/json"
    }

    for model_name in GROQ_TEXT_MODELS:
        try:
            payload: Dict[str, Any] = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 1800
            }
            if json_mode:
                payload["response_format"] = {"type": "json_object"}

            with httpx.Client(timeout=20.0) as client:
                resp = client.post(GROQ_CHAT_URL, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data["choices"][0]["message"]["content"] or ""
                    text = _clean_reasoning_output(raw_text, json_mode=json_mode)
                    logger.info(f"[PLAN B GROQ OK] Respuesta generada con {model_name}")
                    return text, f"{model_name} (PlanB-Groq)"
                else:
                    logger.warning(f"[PLAN B WARN] Groq {model_name} devolvió HTTP {resp.status_code}: {resp.text[:160]}")
        except Exception as e:
            logger.warning(f"[PLAN B WARN] Error en Groq {model_name}: {e}")
            continue

    return None, None


def call_groq_vision(prompt: str, img: Image.Image) -> Tuple[Optional[str], Optional[str]]:
    """
    Plan B Multimodal (Capa 1): Invoca el modelo de Visión de Groq Cloud API cuando Gemini Vision
    presenta error 429 o caída del servicio.
    """
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        logger.warning("[PLAN B VISION] GROQ_API_KEY no configurada en backend/.env.")
        return None, None

    # Comprimir y codificar imagen en Base64 JPEG para envío rápido a Groq Vision
    buffered = BytesIO()
    rgb_img = img.convert("RGB")
    rgb_img.thumbnail((1600, 1600))
    rgb_img.save(buffered, format="JPEG", quality=85)
    b64_img = base64.b64encode(buffered.getvalue()).decode("utf-8")

    headers = {
        "Authorization": f"Bearer {groq_key}",
        "Content-Type": "application/json"
    }

    for model_name in GROQ_VISION_MODELS:
        try:
            payload: Dict[str, Any] = {
                "model": model_name,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}
                            }
                        ]
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 1800,
                "response_format": {"type": "json_object"}
            }

            with httpx.Client(timeout=25.0) as client:
                resp = client.post(GROQ_CHAT_URL, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data["choices"][0]["message"]["content"] or ""
                    text = _clean_reasoning_output(raw_text, json_mode=True)
                    logger.info(f"[PLAN B VISION OK] Imagen analizada con {model_name} (Groq)")
                    return text, f"{model_name} (PlanB-GroqVision)"
                else:
                    logger.warning(f"[PLAN B VISION WARN] Groq {model_name} HTTP {resp.status_code}: {resp.text[:160]}")
        except Exception as e:
            logger.warning(f"[PLAN B VISION WARN] Error en Groq Vision {model_name}: {e}")
            continue

    return None, None


def build_emergency_vision_fallback(filename: str, width: int, height: int) -> Tuple[str, str]:
    """
    Respaldo de seguridad si tanto Gemini como Groq fallan:
    Asigna confidence_score = 65% (< 80%) para enrutar la factura a Revisión Humana sin romper el sistema.
    """
    fallback_json = {
        "category": "Facturas y Cuentas de Cobro",
        "summary": f"Factura en imagen '{filename}' retenida preventivamente para Revisión Humana (Contingencia de cuota API).",
        "ocr_text": f"Imagen de factura {filename} ({width}x{height}px) pendiente de validación humana.",
        "extracted_data": {
            "emisor_nombre": "Pendiente de validación en pantalla",
            "emisor_nit": None,
            "numero_factura": None,
            "fecha_emision": None,
            "fecha_vencimiento": None,
            "moneda": "COP",
            "items": [],
            "monto_subtotal": 0.0,
            "monto_impuestos": 0.0,
            "monto_total": 0.0,
            "metodo_pago": "Por confirmar",
            "confidence_score": 65.0,
            "low_confidence_reason": "Proveedores de IA en límite de cuota. Se solicita confirmación visual humana (Human-in-the-Loop)."
        }
    }
    return json.dumps(fallback_json), "PlanB-LocalContingency"

