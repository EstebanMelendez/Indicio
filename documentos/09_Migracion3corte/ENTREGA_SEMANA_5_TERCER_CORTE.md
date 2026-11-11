# Entrega Semana 5 – Tercer Corte: Documento Técnico Consolidado, Guion de Video (8 Minutos) y Guía de Sustentación

**Proyecto:** Indicio Enterprise (DocuMind)  
**Asignatura:** Desarrollo de Aplicaciones Empresariales  
**Docente:** Wilson Castaño Galviz  
**Estudiante:** Juan Esteban Rojas Meléndez  
**Institución:** Unidades Tecnológicas de Santander (UTS)  
**Fecha:** Noviembre de 2026  

---

## 1. Síntesis Técnica del Proyecto (Tercer Corte)

**Indicio Enterprise (DocuMind)** evolucionó de un sistema dependiente de flujos visuales en n8n con tokens OAuth2 que caducaban, hacia una **arquitectura autónoma en código Python (FastAPI)** potenciada por **LangGraph**, **LangChain**, **Visión por Computador Multimodal (Gemini Vision + Groq Vision)** y **automatización de correo por SMTP/IMAP**.

### Mapa General de Componentes del Tercer Corte:

| Componente de la Rúbrica | Puntaje | Implementación Técnica en Indicio Enterprise | Archivos Clave |
| :--- | :-: | :--- | :--- |
| **1. Automatización en Código (Ruta B + Python)** | **25 pts** | • Flujo contable de Cuentas por Pagar en **LangGraph** (`StateGraph`).<br>• Agente conversacional RAG Híbrido con memoria por `session_id` en **LangChain**.<br>• Envío de tarjetas interactivas de aprobación, etiquetado en Gmail e ingesta IMAP 100% en Python. | [`invoice_workflow.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/workflows/invoice_workflow.py)<br>[`rag_agent.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/workflows/rag_agent.py)<br>[`email_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/email_service.py) |
| **2. Módulo de Visión por Computador** | **25 pts** | • Caso de uso: **Lectura Inteligente de Facturas y Recibos (`.jpg`, `.png`, `.webp`)**.<br>• Extracción JSON de `emisor_nombre`, `emisor_nit`, `numero_factura`, `fecha_emision`, `items` (tabla detallada), `monto_total` y `confidence_score`.<br>• Captura desde cámara móvil (`capture="environment"`), Web, Telegram y Correo. | [`vision_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/vision_service.py)<br>[`Repository.jsx`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/frontend/src/components/Repository.jsx)<br>[`telegram_bot_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/telegram_bot_service.py) |
| **3. Integración y Validación Humana (Human-in-the-Loop)** | **15 pts** | • Si `confidence_score < 80%`, retiene la factura en `"Requiere Revisión"` y despliega el formulario de validación humana con botones para **Confirmar/Corregir** o **Rechazar por Ilegible**.<br>• Si `>= 80%`, valida duplicados en PostgreSQL, aprueba sola si `< $1.000.000 COP` o solicita aprobación gerencial por correo si `>= $1.000.000 COP`. | [`DocumentViewer.jsx`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/frontend/src/components/DocumentViewer.jsx)<br>[`main.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/main.py#L1260-L1395) |
| **4. Calidad Transversal (Seguridad Ley 1581, Plan B, Pruebas)** | **35 pts** | • **Ley 1581:** Cifrado `ENC::` (`Fernet` AES-128 + RSA-2048), roles JWT (`admin`, `auditor`, `user`), `uploaded_by` y tabla `workflow_audit_logs`.<br>• **Plan B:** Conmutación automática a **Groq Cloud API** (`openai/gpt-oss-120b` y `qwen/qwen3.8-27b`).<br>• **Pruebas:** 7 tests en `pytest` (`7 passed`) + Matriz de 20 fotos de facturas (100% precisión). | [`crypto.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/crypto.py)<br>[`fallback_service.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/app/fallback_service.py)<br>[`test_tercer_corte.py`](file:///c:/Users/USUARIO/Documents/DocuMind-Final/backend/test_tercer_corte.py) |
