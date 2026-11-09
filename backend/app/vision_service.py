import os
import re
import json
import time
import logging
from typing import Dict, Any, Optional
from PIL import Image
import google.generativeai as genai
from sqlalchemy.orm import Session
from app.models import WorkflowAuditLog
from app.fallback_service import call_groq_vision, build_emergency_vision_fallback

logger = logging.getLogger("IndicioVision")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

def is_image_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in IMAGE_EXTENSIONS

def _clean_number(val: Any) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    clean_str = str(val).replace("$", "").replace("USD", "").replace("COP", "").replace("EUR", "").replace(" ", "").strip()
    try:
        if "," in clean_str and "." in clean_str:
            if clean_str.rfind(",") > clean_str.rfind("."):
                clean_str = clean_str.replace(".", "").replace(",", ".")
            else:
                clean_str = clean_str.replace(",", "")
        elif "," in clean_str:
            # Si tiene 3 dígitos después de la coma (ej: 120,000), es separador de miles
            parts = clean_str.split(",")
            if len(parts) == 2 and len(parts[1]) == 3:
                clean_str = clean_str.replace(",", "")
            else:
                clean_str = clean_str.replace(",", ".")
        elif "." in clean_str:
            parts = clean_str.split(".")
            if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3):
                clean_str = clean_str.replace(".", "")
        return float(clean_str)
    except Exception:
        return 0.0

def analyze_invoice_image(
    file_path: str,
    filename: str,
    tenant_id: int = 1,
    document_id: Optional[int] = None,
    user_email: str = "sistema@indicio.internal",
    trigger_source: str = "WebVision",
    db: Optional[Session] = None
) -> Dict[str, Any]:
    """
    Módulo de Visión por Computador (Componente 2 - Tercer Corte):
    Recibe una fotografía real tomada con celular (.jpg, .png, .webp) de una factura o recibo,
    extrae proveedor, NIT, fecha, arreglo de ítems, total y nivel de confianza (0 a 100%).
    """
    start_time = time.time()
    img = Image.open(file_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    vision_prompt = """Eres un sistema experto de Visión por Computador y Auditoría Contable para Colombia.
Analiza esta imagen (fotografía de celular o escaneo) y responde ESTRICTAMENTE en formato JSON válido sin markdown.

Debes extraer todos los datos visibles, incluyendo la tabla de productos/servicios (items) y evaluar objetivamente el nivel de confianza visual (`confidence_score` de 0 a 100) según la nitidez de la foto, iluminación y legibilidad de los números.

ESQUEMA JSON OBLIGATORIO:
{
    "category": "Facturas y Cuentas de Cobro",
    "summary": "Resumen ejecutivo de la factura o recibo indicando emisor, ítems principales y total",
    "ocr_text": "Transcripción completa de todo el texto legible en la imagen para indexación semántica RAG",
    "extracted_data": {
        "emisor_nombre": "Nombre del proveedor, tienda o comercio emisor",
        "emisor_nit": "NIT o identificación fiscal del emisor (o null si no es legible)",
        "numero_factura": "Número o consecutivo de la factura o recibo",
        "fecha_emision": "Fecha de emisión en formato YYYY-MM-DD (o texto original)",
        "fecha_vencimiento": "Fecha de vencimiento YYYY-MM-DD o null",
        "moneda": "COP",
        "items": [
            {
                "descripcion": "Nombre del producto o servicio",
                "cantidad": 1,
                "precio_unitario": 0.0,
                "subtotal": 0.0
            }
        ],
        "monto_subtotal": 0.0,
        "monto_impuestos": 0.0,
        "monto_total": 0.0,
        "metodo_pago": "Efectivo, Tarjeta, Transferencia o Crédito",
        "confidence_score": 92.0,
        "low_confidence_reason": null
    }
}

REGLAS ESTRICTAS:
1. Todos los montos (`monto_subtotal`, `monto_impuestos`, `monto_total`, `precio_unitario`, `subtotal`) deben ser números puros sin símbolo '$' ni separadores de miles.
2. Si la imagen está borrosa, cortada, muy oscura o no es posible leer claramente el monto total o el proveedor, asigna un `confidence_score` menor a 75 y explica la razón en `low_confidence_reason` (ej: "Foto borrosa en la zona del NIT y total").
3. Si la imagen es nítida y los montos son claramente legibles, asigna un `confidence_score` entre 85 y 99."""

    candidate_models = list(dict.fromkeys([
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite")
    ]))

    response_text = None
    provider_used = "gemini-3.5-flash-lite (Vision)"
    last_error = None

    for model_name in candidate_models:
        try:
            curr_model = genai.GenerativeModel(model_name)
            res = curr_model.generate_content(
                [vision_prompt, img],
                generation_config={"response_mime_type": "application/json"}
            )
            response_text = res.text.strip()
            provider_used = f"{model_name} (Vision)"
            logger.info(f"[VISION OK] Imagen '{filename}' analizada con {model_name}")
            break
        except Exception as e:
            last_error = e
            logger.warning(f"[VISION WARN] Fallo en modelo visual {model_name}: {e}. Probando siguiente...")
            continue

    if not response_text:
        logger.warning(f"[VISION PLAN B] Todos los modelos de Gemini fallaron para '{filename}'. Activando Plan B en Groq Vision...")
        groq_text, groq_provider = call_groq_vision(vision_prompt, img)
        if groq_text:
            response_text = groq_text
            provider_used = groq_provider or "Groq-Vision (PlanB)"
        else:
            response_text, provider_used = build_emergency_vision_fallback(filename, img.width, img.height)

    if response_text.startswith("```json"):
        response_text = response_text[7:-3].strip()
    elif response_text.startswith("```"):
        response_text = response_text[3:-3].strip()

    parsed = json.loads(response_text)
    extracted = parsed.get("extracted_data") or {}

    # Normalizar montos numéricos e ítems
    for k in ["monto_total", "monto_subtotal", "monto_impuestos"]:
        if k in extracted:
            extracted[k] = _clean_number(extracted.get(k))

    raw_items = extracted.get("items")
    cleaned_items = []
    if isinstance(raw_items, list):
        for it in raw_items:
            if isinstance(it, dict):
                qty = _clean_number(it.get("cantidad", 1)) or 1.0
                unit_p = _clean_number(it.get("precio_unitario", 0))
                sub_p = _clean_number(it.get("subtotal", 0))
                if sub_p == 0.0 and unit_p > 0:
                    sub_p = qty * unit_p
                cleaned_items.append({
                    "descripcion": str(it.get("descripcion") or "Ítem"),
                    "cantidad": qty,
                    "precio_unitario": unit_p,
                    "subtotal": sub_p
                })
    extracted["items"] = cleaned_items

    # Normalizar y calibrar confidence_score (0 - 100)
    raw_conf = extracted.get("confidence_score", 88.0)
    try:
        conf = float(raw_conf)
        if conf <= 1.0:
            conf = conf * 100.0
    except Exception:
        conf = 85.0

    # Penalización automática si faltan campos críticos de la factura
    missing_fields = []
    if not extracted.get("emisor_nombre"):
        missing_fields.append("proveedor")
    if not extracted.get("monto_total") or float(extracted.get("monto_total", 0)) <= 0:
        missing_fields.append("monto_total")
    if not extracted.get("emisor_nit"):
        missing_fields.append("NIT")

    if "monto_total" in missing_fields or "proveedor" in missing_fields:
        conf = min(conf, 65.0)
        if not extracted.get("low_confidence_reason"):
            extracted["low_confidence_reason"] = f"No se detectaron con claridad campos críticos: {', '.join(missing_fields)}."

    conf = round(max(0.0, min(100.0, conf)), 1)
    extracted["confidence_score"] = conf
    extracted["processed_by_vision"] = True

    # Construir texto OCR enriquecido para que el documento también sea consultable desde el Chatbot RAG
    ocr_text = parsed.get("ocr_text") or ""
    items_txt = "\n".join([
        f"- {i['cantidad']}x {i['descripcion']}: ${i['subtotal']:,.0f}" for i in cleaned_items
    ])
    enriched_text = (
        f"FACTURA PROCESADA POR VISIÓN POR COMPUTADOR ({filename})\n"
        f"Proveedor: {extracted.get('emisor_nombre') or 'N/A'} | NIT: {extracted.get('emisor_nit') or 'N/A'}\n"
        f"Factura N°: {extracted.get('numero_factura') or 'N/A'} | Fecha: {extracted.get('fecha_emision') or 'N/A'}\n"
        f"Monto Total: ${extracted.get('monto_total', 0):,.2f} {extracted.get('moneda', 'COP')} | Confianza Visual: {conf}%\n"
        f"Ítems / Productos:\n{items_txt}\n\n"
        f"Texto Transcrito:\n{ocr_text}"
    ).strip()

    duration_ms = int((time.time() - start_time) * 1000)

    # Registrar auditoría de Visión en WorkflowAuditLog si hay sesión de BD
    if db is not None:
        try:
            audit_log = WorkflowAuditLog(
                tenant_id=tenant_id,
                document_id=document_id,
                workflow_name="VisionPorComputador-Facturas",
                trigger_source=trigger_source,
                user_email=user_email,
                ai_provider=provider_used,
                input_summary=f"Imagen: {filename} ({img.width}x{img.height}px)",
                output_result={
                    "proveedor": extracted.get("emisor_nombre"),
                    "nit": extracted.get("emisor_nit"),
                    "numero_factura": extracted.get("numero_factura"),
                    "items_count": len(cleaned_items),
                    "monto_total": extracted.get("monto_total"),
                    "confidence_score": conf,
                    "requires_review": conf < 80.0
                },
                confidence_score=int(conf),
                status="REQUIRES_REVIEW" if conf < 80.0 else "SUCCESS",
                execution_time_ms=duration_ms
            )
            db.add(audit_log)
            db.commit()
        except Exception as log_err:
            logger.warning(f"No se pudo registrar log de visión: {log_err}")

    return {
        "category": parsed.get("category") or "Facturas y Cuentas de Cobro",
        "summary": parsed.get("summary") or f"Factura de {extracted.get('emisor_nombre', 'proveedor')} por ${extracted.get('monto_total', 0):,.0f}",
        "extracted_data": extracted,
        "raw_text": enriched_text,
        "confidence_score": conf,
        "duration_ms": duration_ms
    }

