# Memoria del Proyecto: Indicio Enterprise (DocuMind) – Tercer Corte

Este archivo (`GEMINI.md`) sirve como memoria persistente para el asistente Antigravity en todas las sesiones de este proyecto.

## 1. Contexto Académico y Objetivo del Tercer Corte
* **Asignatura:** Desarrollo de Aplicaciones Empresariales (Docente: Wilson Castaño Galviz).
* **Meta del Tercer Corte:**
  1. **Componente 1 (Automatización en Código - 25 pts):** Eliminar la dependencia de n8n Cloud y evitar tener que abrir `localhost:5678` en Chrome para activar flujos o reconectar credenciales OAuth2. Migrar los flujos principales a **código Python (FastAPI)** usando **LangChain / LangGraph** (Ruta B con `indicio_n8n` en Docker + flujos de IA y negocio 100% en Python). Todas las credenciales deben vivir en [`backend/.env`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/.env) (incluyendo Contraseña de Aplicación de Gmail `GMAIL_APP_PASSWORD` para que no caduque nunca).
  2. **Componente 2 (Visión por Computador - 25 pts):** Caso de uso elegido: **Lectura de Facturas o Recibos (Cuentas por Pagar)**. Recibir fotos reales tomadas con celular (`.jpg`, `.png`, `.webp`) o PDFs escaneados desde la Web/Celular, Bot de Telegram o Correo. Extraer con **Gemini 2.0 Flash Vision**: `emisor_nombre`, `emisor_nit`, `numero_factura`, `fecha_emision`, `items` (productos/servicios), `monto_total` y `confidence_score` (nivel de confianza).
  3. **Integración y Validación Humana (15 pts):** Si `confidence_score < 0.80` (80%), mostrar los datos en pantalla para revisión del usuario antes de guardar (`"Requiere Revisión"`). Si `>= 0.80`, disparar automáticamente el flujo contable en código (verificar duplicados en PostgreSQL; si `< $1.000.000 COP` aprobar automáticamente; si `>= $1.000.000 COP` enviar correo interactivo con botones de aprobación directa al backend). El chatbot de Telegram (`backend/telegram_bot_service.py`) también debe recibir fotos de facturas.
  4. **Calidad Transversal (35 pts):**
     * **Seguridad y Ley 1581 (10 pts):** Roles JWT (`admin`, `auditor`, `user`), guardar quién subió cada imagen (`uploaded_by`), tabla de historial de ejecuciones (`WorkflowAuditLog`) y protección de datos personales (Ley 1581 de 2012).
     * **Pruebas y Plan B (10 pts):** Corregir los nombres de modelos en `backend/main.py` y agregar Plan B gratuito (Groq API / EasyOCR + Ollama local) si Gemini da error `429`. Pruebas unitarias (`pytest`) y matriz de pruebas con **20 fotos reales tomadas con celular**.
     * **Despliegue y Documentación (10 pts) + Sustentación (5 pts):** `Dockerfile` para backend/frontend y despliegue en un servidor público en internet.

## 2. Estado de Avance por Semanas (Cronograma del Corte)
* ✅ **Semana 1 (Completada):** Inventario de los 5 flujos de n8n, elección de Ruta B + migración a Python para no depender de abrir Chrome, elección del caso de uso (Lectura de Facturas) y diagrama de arquitectura. Documento generado en [`documentos/02_Diseno/ENTREGA_SEMANA_1_TERCER_CORTE.md`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/documentos/02_Diseno/ENTREGA_SEMANA_1_TERCER_CORTE.md).
* ⏳ **Semana 2 (Siguiente paso):** Programar el motor de automatización en código Python (FastAPI + LangChain/LangGraph), migrar el chatbot con memoria y herramientas, configurar credenciales directas en `.env` (sin depender de abrir Chrome en n8n), manejo de errores/reintentos y tabla de registro (`WorkflowAuditLog`) de cada ejecución.
* ⏳ **Semana 3:** Módulo de visión por computador (`vision_service.py`), captura de fotos desde celular en React (`Repository.jsx`), revisión humana en `DocumentViewer.jsx` y recepción de fotos en `telegram_bot_service.py`.
* ⏳ **Semana 4:** Integración completa, Plan B ante fallos de cuota, seguridad Ley 1581, pruebas con las 20 imágenes reales y despliegue en servidor público.
* ⏳ **Semana 5:** Documentación técnica final (máx. 10 páginas), guion de video (8 min) y preparación de preguntas de sustentación.

## 3. Reglas de Comunicación con el Usuario
* Explicar siempre los conceptos de forma **clara, directa y sencilla**, evitando jerga innecesaria.
* Avanzar paso a paso siguiendo el cronograma de las 5 semanas de la guía académica.

