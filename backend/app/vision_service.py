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

    vision_prompt = f"Nombre del archivo a analizar: '{filename}'\n" + """Eres un sistema experto de Visión por Computador, Gestión Documental Inteligente y Auditoría Contable para Colombia.
Analiza esta imagen (fotografía tomada con celular o documento escaneado) y responde ESTRICTAMENTE en formato JSON válido sin markdown.

1. CLASIFICACIÓN OBLIGATORIA (`category`):
Debes clasificar la imagen en UNA de las siguientes categorías oficiales del sistema:
- "Facturas y Cuentas de Cobro" (por defecto si es una factura, cuenta de cobro o si la imagen está borrosa/manchada/ilegible)
- "Recibos y Comprobantes de Pago"
- "Hojas de Vida / Perfiles Laborales" (SOLO si el documento muestra claramente estudios, experiencia laboral y habilidades de un candidato)
- "Contratos y Acuerdos Legales"
- "Reportes y Estados Financieros"
- "Actas de Reunión"
- "Manuales y Procedimientos"

2. EXTRACCIÓN ESTRUCTURADA (`extracted_data`) SEGÚN LA CATEGORÍA:
Evalúa siempre `confidence_score` (de 0 a 100) según la nitidez de la foto, iluminación y legibilidad.
- Si es "Facturas y Cuentas de Cobro" o "Recibos y Comprobantes de Pago", incluye:
  "emisor_nombre", "emisor_nit", "numero_factura", "fecha_emision" (YYYY-MM-DD), "fecha_vencimiento", "moneda" ("COP"),
  "items": [ { "descripcion": "...", "cantidad": 1, "precio_unitario": 0.0, "subtotal": 0.0 } ],
  "monto_subtotal": 0.0, "monto_impuestos": 0.0, "monto_total": 0.0, "metodo_pago": "...", "concepto_principal": "...",
  "confidence_score": 94.0, "low_confidence_reason": null
- Si es "Hojas de Vida / Perfiles Laborales", incluye:
  "postulante" (nombre completo), "rol" (cargo o especialidad), "anos_experiencia" (número),
  "competencias" (array de strings), "formacion" (estudios), "contacto_ubicacion" (ciudad),
  "match_score" (puntaje de perfil 0-100), "green_flags" (array de fortalezas), "resumen_scouting" (síntesis de 2 líneas),
  "confidence_score": 94.0
- Si es "Contratos y Acuerdos Legales", incluye:
  "partes", "objeto", "vigencia", "valor", "emisor_nombre" (entidad contratante), "monto_total" (valor numérico si aplica), "confidence_score": 94.0
- Si es "Reportes y Estados Financieros", "Actas de Reunión" o "Manuales y Procedimientos", incluye:
  "titulo", "empresa", "fecha_emision", "departamento", "conclusiones", "confidence_score": 94.0

ESQUEMA JSON DE RESPUESTA:
{
    "category": "Una de las categorías oficiales listadas arriba",
    "summary": "Resumen ejecutivo claro de 2 líneas describiendo el documento analizado por visión",
    "ocr_text": "Transcripción completa de todo el texto legible en la imagen para indexación semántica RAG",
    "extracted_data": {
        "confidence_score": 92.0,
        "low_confidence_reason": null
    }
}

REGLAS ESTRICTAS:
1. Todos los montos numéricos (`monto_total`, `monto_subtotal`, `monto_impuestos`, `precio_unitario`, `subtotal`) deben ser números puros sin símbolo '$' ni separadores de miles.
2. Si la imagen está borrosa, manchada, cortada o no es posible leer con certeza los datos clave, asigna un `confidence_score` menor a 75 y explica el motivo en `low_confidence_reason`.
3. Si la imagen es nítida y perfectamente legible, asigna un `confidence_score` entre 86 y 99."""

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

    detected_category = parsed.get("category") or "Facturas y Cuentas de Cobro"
    fname_lower = filename.lower()
    if any(k in fname_lower for k in ["factura", "cobro"]) and "Factura" not in detected_category:
        detected_category = "Facturas y Cuentas de Cobro"
    elif any(k in fname_lower for k in ["recibo", "comprobante"]) and "Recibo" not in detected_category:
        detected_category = "Recibos y Comprobantes de Pago"
    elif conf < 80.0 and "Vida" in detected_category and str(extracted.get("postulante", "")).lower() in ["", "no disponible", "no detectado", "none"]:
        detected_category = "Facturas y Cuentas de Cobro"

    is_invoice_or_receipt = any(k in detected_category for k in ["Factura", "Recibo", "Cobro"])

    # Penalización automática solo si es factura/recibo y faltan campos críticos
    if is_invoice_or_receipt:
        missing_fields = []
        if not extracted.get("emisor_nombre") and not extracted.get("proveedor"):
            missing_fields.append("proveedor")
        if not extracted.get("monto_total") or float(extracted.get("monto_total", 0)) <= 0:
            missing_fields.append("monto_total")
        if not extracted.get("emisor_nit") and "Factura" in detected_category:
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
    items_block = f"Ítems / Productos:\n{items_txt}\n\n" if items_txt else ""
    enriched_text = (
        f"DOCUMENTO PROCESADO POR VISIÓN POR COMPUTADOR ({filename}) - Categoría: {detected_category}\n"
        f"Resumen: {parsed.get('summary') or ''}\n"
        f"Emisor/Postulante: {extracted.get('emisor_nombre') or extracted.get('postulante') or extracted.get('partes') or 'N/A'} | NIT: {extracted.get('emisor_nit') or 'N/A'}\n"
        f"Monto/Valor: ${extracted.get('monto_total', 0):,.2f} {extracted.get('moneda', 'COP')} | Confianza Visual: {conf}%\n"
        f"{items_block}"
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
        "category": detected_category,
        "summary": parsed.get("summary") or f"Documento analizado por Visión IA ({detected_category})",
        "extracted_data": extracted,
        "raw_text": enriched_text,
        "confidence_score": conf,
        "duration_ms": duration_ms
    }

