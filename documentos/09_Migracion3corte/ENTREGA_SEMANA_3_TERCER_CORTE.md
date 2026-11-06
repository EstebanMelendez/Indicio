# Entrega Semana 3 – Tercer Corte: Módulo de Visión por Computador, Validación Humana (Human-in-the-Loop) y Recepción por Telegram

**Proyecto:** Indicio Enterprise (DocuMind)  
**Asignatura:** Desarrollo de Aplicaciones Empresariales  
**Docente:** Wilson Castaño Galviz  
**Fecha:** Noviembre de 2026  

---

## 1. Objetivo de la Semana 3

Conforme al cronograma oficial de la Guía de Actividad del Tercer Corte, en la **Semana 3** se construyó de extremo a extremo el **Componente 2 (Módulo de Visión por Computador – 25 puntos)** y el **Componente 3 (Integración y Validación Humana – 15 puntos)** para el caso de uso seleccionado: **Lectura Inteligente de Facturas y Recibos (Cuentas por Pagar)**.

---

## 2. Arquitectura e Implementación por Fases

### 2.1. Fase 1: Servicio Multimodal de Visión por Computador en Backend (`backend/app/vision_service.py`)
Se creó el módulo especializado [`backend/app/vision_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/vision_service.py) e integró con el procesador en segundo plano de [`backend/main.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/main.py):

1. **Formatos soportados:** Se amplió el endpoint `POST /api/documents/upload` para aceptar fotografías tomadas con celular o escaneos en formatos `.jpg`, `.jpeg`, `.png` y `.webp` (además de `.pdf`, `.docx` y `.txt`).
2. **Preprocesamiento de imagen (`Pillow`):** Normalización automática a canal `RGB` y redimensionamiento inteligente (`thumbnail(2048, 2048)`) para acelerar el análisis de fotos de alta resolución tomadas desde cámaras móviles.
3. **Extracción Multimodal Estructurada con Gemini Vision:** Envía la imagen junto con un esquema JSON estricto a los modelos multimodales rápidos (`gemini-3.5-flash-lite` -> `gemini-3.1-flash-lite` -> `gemini-3.5-flash`) para extraer los **6 campos obligatorios de la guía**:
   * `emisor_nombre` (Nombre o razón social del proveedor)
   * `emisor_nit` (NIT o identificación tributaria)
   * `numero_factura` (Consecutivo de factura o recibo)
   * `fecha_emision` (Fecha en formato `YYYY-MM-DD`)
   * `items` (Arreglo detallado de productos/servicios con `descripcion`, `cantidad`, `precio_unitario` y `subtotal`)
   * `monto_total` (Valor total numérico limpio)
   * `confidence_score` (Nivel de confianza de lectura de `0` a `100%` + `low_confidence_reason`)
   * `ocr_text` (Transcripción completa de la factura para indexación vectorial en `pgvector` y consultas desde el chatbot RAG)

### 2.2. Fase 2: Validación Humana (`Human-in-the-Loop`) y Umbral del 80%
1. **Regla de Confianza `< 80%`:**
   * Si `confidence_score < 80.0`, el documento se marca con estado **`"Requiere Revisión"`** y el grafo de LangGraph ([`invoice_workflow.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/workflows/invoice_workflow.py)) detiene la aprobación contable automática, ubicando el documento en la carpeta **`"Requiere Revisión"`** con estado contable `RETENIDO_BAJA_CONFIANZA`.
   * Si `confidence_score >= 80.0`, el documento pasa a `"Procesado"` y dispara automáticamente las reglas contables en código (verificación de duplicados en PostgreSQL y aprobación automática si `< $1.000.000 COP` o solicitud de aprobación gerencial si `>= $1.000.000 COP`).
2. **Endpoint de Confirmación Humana (`POST /api/documents/{doc_id}/confirm-vision`):**
   * Permite que un usuario humano revise la imagen original junto a los campos detectados, corrija cualquier dato o ítem en pantalla, eleve la confianza al `100%` (`human_verified = True`) y dispare en ese instante el flujo contable en código (`trigger_source="HumanValidation-UI"`).

### 2.3. Fase 3: Captura Móvil y Visor Interactivo en React (`Repository.jsx` y `DocumentViewer.jsx`)
1. **Captura desde Celular en [`Repository.jsx`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/frontend/src/components/Repository.jsx):**
   * Se añadió el botón **`📸 Capturar Factura`** con atributo HTML5 `accept="image/*" capture="environment"`, el cual abre directamente la cámara trasera al abrir la aplicación desde un teléfono móvil.
   * La tabla del repositorio muestra ahora el ícono de imagen, el autor de la carga (`Subido por: ...`), el filtro de estado `Requiere Revisión (<80%)` y la insignia de confianza **`🎯 XX%`**.
2. **Panel de Visión y Formulario de Revisión Humana en [`DocumentViewer.jsx`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/frontend/src/components/DocumentViewer.jsx):**
   * Muestra la **vista previa de la fotografía original** capturada al lado de los datos extraídos.
   * Renderiza la **tabla estructurada de ítems** (`Descripción`, `Cant.`, `V. Unitario`, `Subtotal`).
   * Si la factura tiene confianza `< 80%` (o cuando el usuario hace clic en `Editar / Validar Datos`), despliega el **Formulario de Validación Humana** editable con el botón **`✅ Confirmar Datos y Ejecutar Flujo Contable`**.

### 2.4. Fase 4: Recepción de Fotos de Facturas por el Bot de Telegram (`backend/telegram_bot_service.py`)
Se actualizó [`backend/telegram_bot_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/telegram_bot_service.py) para que el bot `@Indicion8n_bot` opere de forma bimodal:
* **Modo 1 – Recepción de Fotos de Facturas (`msg["photo"]` o imagen adjunta):** Descarga la foto desde los servidores de Telegram (`getFile`), la sube a `/api/documents/upload`, espera el análisis de Visión Computacional + LangGraph y responde en el chat de Telegram con el resumen estructurado (Proveedor, NIT, N° Factura, Fecha, Monto Total, Ítems detectados, `%` de Confianza IA y Estado Contable).
* **Modo 2 – Consultas RAG con Memoria Conversacional (`msg["text"]`):** Responde preguntas en lenguaje natural sobre las facturas recién subidas por foto o sobre cualquier documento del repositorio recordando el contexto de la conversación por `chat_id`.

---

## 3. Prueba Real Ejecutada (Evidencia de Funcionamiento)

Se ejecutó una prueba de integración real subiendo la imagen `factura_foto_celular_test.png` (`doc_id: 27`) al endpoint `/api/documents/upload`. El motor de visión y el grafo contable produjeron el siguiente resultado en PostgreSQL:

```json
{
  "emisor_nombre": "SERVICIOS CLOUD COLOMBIA S.A.S.",
  "emisor_nit": "901.456.789-2",
  "numero_factura": "FEV-9045",
  "fecha_emision": "2026-11-05",
  "moneda": "COP",
  "items": [
    {
      "descripcion": "Licencia Servidor Cloud GPU",
      "cantidad": 1.0,
      "precio_unitario": 450000.0,
      "subtotal": 450000.0
    },
    {
      "descripcion": "Soporte Tecnico Especializado",
      "cantidad": 2.0,
      "precio_unitario": 150000.0,
      "subtotal": 300000.0
    }
  ],
  "monto_subtotal": 750000.0,
  "monto_impuestos": 142500.0,
  "monto_total": 892500.0,
  "metodo_pago": "Transferencia",
  "confidence_score": 98.0,
  "processed_by_vision": true,
  "estado_contable": "APROBADA_AUTOMATICA",
  "notas_auditoria": "Aprobada automáticamente por regla contable: Monto $892,500.00 menor a $1'000.000 COP."
}
```

