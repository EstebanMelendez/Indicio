# Indicio Enterprise (DocuMind) — Plataforma Inteligente de Gestión Documental, Visión IA y Automatización en Código

**Indicio Enterprise** es una plataforma empresarial multi-inquilino (*Multi-Tenant*) de gestión documental inteligente, automatización contable en código (**LangGraph**), asistente conversacional **RAG con memoria (LangChain)** y **Visión por Computador (Gemini Flash Vision + Plan B en Groq Cloud API)** bajo cumplimiento estricto de la **Ley 1581 de 2012 (Habeas Data Colombia)**.

---

## 🏗️ Arquitectura Principal (Tercer Corte)

1. **Automatización 100% en Código Python (`FastAPI` + `LangGraph` + `LangChain`):**
   - **Cuentas por Pagar ([`invoice_workflow.py`](backend/app/workflows/invoice_workflow.py)):** Grafo de estados en `LangGraph` que valida nivel de confianza visual (`>= 80%`), bloquea facturas duplicadas en PostgreSQL (`NIT` + `numero_factura`), aprueba automáticamente montos `< $1.000.000 COP` y envía correos interactivos con botones firmados (`HMAC-SHA256`) a Gerencia para montos `>= $1.000.000 COP`.
   - **Agente RAG con Memoria Conversacional ([`rag_agent.py`](backend/app/workflows/rag_agent.py)):** Búsqueda vectorial híbrida en `PostgreSQL + pgvector` (768 dimensiones) con historial de conversación aislado por `session_id` (Web y Bot de Telegram).
   - **Correo Bidireccional Nativo ([`email_service.py`](backend/app/email_service.py)):** Ingesta automática de adjuntos vía `IMAP4_SSL` y notificaciones con etiquetado automático vía `SMTP_SSL` usando `GMAIL_APP_PASSWORD` en `backend/.env` (sin caducidad de tokens OAuth2 ni dependencia de abrir n8n en el navegador).

2. **Visión por Computador Multicategoría y Validación Humana ([`vision_service.py`](backend/app/vision_service.py)):**
   - Recibe fotografías tomadas con celular (`.jpg`, `.png`, `.webp`) desde la Web, Cámara Móvil, Bot de Telegram o Correo.
   - Clasifica automáticamente en todas las categorías del sistema (*Facturas y Cuentas de Cobro*, *Recibos y Comprobantes de Pago*, *Hojas de Vida / Perfiles Laborales*, *Contratos y Acuerdos Legales*, *Reportes y Estados Financieros*, *Actas de Reunión*) extrayendo ítems, NIT, montos y `confidence_score` (0–100%).
   - **Human-in-the-Loop (`< 80%`):** Retiene imágenes borrosas o manchadas en estado `"Requiere Revisión"` para corrección o rechazo manual en [`DocumentViewer.jsx`](frontend/src/components/DocumentViewer.jsx).
   - **Plan B Resiliente ([`fallback_service.py`](backend/app/fallback_service.py)):** Conmutación automática a **Groq Cloud API** y contingencia local ante errores de cuota `429`.

3. **Seguridad y Protección de Datos Personales — Ley 1581 de 2012 ([`crypto.py`](backend/app/crypto.py) y [`auth.py`](backend/app/auth.py)):**
   - **Datos en Reposo:** Cifrado simétrico autenticado `AES-128-CBC + HMAC-SHA256 (Fernet)` respaldado por llaves `RSA-2048` en PostgreSQL (`_encrypted_data`), enmascaramiento de PII y particionamiento físico por organización (`storage/tenant_{id}/`).
   - **Usuarios, Roles y Multi-Tenant SaaS:** Contraseñas con hash `bcrypt`, sesiones `JWT (HS256)` con revocación en `BlacklistedToken` y jerarquía de 4 niveles:
     - **`superadmin` (`AdminEstebanM@gmail.com`):** Consola Global SaaS para dar de alta nuevas empresas (`Tenant`), crear su bóveda aislada (`storage/tenant_N/`) y su Administrador inicial.
     - **`admin` (Administrador de Empresa):** Pestaña exclusiva **"Usuarios y Roles"** para crear `user` y `auditor` en su empresa y enlazar el correo **Gmail corporativo** directamente con su repositorio (`storage/tenant_N/`).
     - **`auditor` (Auditor Ley 1581):** Inspección de trazabilidad (`WorkflowAuditLog`) y revisión documental en solo lectura.
     - **`user` (Operador):** Subida de archivos/facturas, validación humana y consultas al Asistente IA.
   - **Trazabilidad y Habeas Data:** Registro inmutable en `workflow_audit_logs` organizado cronológicamente por **Mes y Semana activa** en el Dashboard, incluyendo actas de supresión permanente de datos.

---

## 🚀 Ejecución Rápida en Local

### 1. Base de Datos (`PostgreSQL 16 + pgvector`)
```bash
docker-compose up -d
```

### 2. Backend (`FastAPI`)
```bash
cd backend
venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
*(Al iniciar, el backend crea automáticamente las tablas, la organización principal y los usuarios iniciales, además de levantar el lector de Gmail IMAP y el Bot de Telegram).*

### 3. Frontend (`React + Vite`)
```bash
cd frontend
npm run dev
```
Accede en `http://localhost:5173`:
- **Superusuario Global SaaS (Crea Empresas y sus Admins):** `AdminEstebanM@gmail.com` / `zoan2006`
- **Admin Empresa Principal:** `indicio.admin@gmail.com` / `admin123`
- **Auditor:** `indicio.auditor@gmail.com` / `auditor123`
- **Usuario / Operador:** `indicio.user@gmail.com` / `user123`

---

## 🧪 Pruebas Automatizadas (`Pytest`) y Batería de 20 Imágenes

Ejecutar la suite de 8 pruebas unitarias y de integración:
```bash
.\backend\venv\Scripts\pytest.exe backend\test_tercer_corte.py -v
```

La carpeta con las **20 imágenes de prueba multicategoría** para subida manual se encuentra fuera del repositorio en:
- `C:\Users\USUARIO\Desktop\Imagenes_Prueba_DocuMind_20`
- `C:\Users\USUARIO\Documents\Imagenes_Prueba_DocuMind_20`

---

## ☁️ Despliegue en Producción (Railway / Docker)

El proyecto incluye un [`Dockerfile`](Dockerfile) multi-etapa en la raíz y configuración [`railway.json`](railway.json) que compila el Frontend de React y lo sirve directamente desde FastAPI junto con el Bot de Telegram y el trabajador IMAP en un único servicio con HTTPS automático y healthcheck en `/api/health`.

---

## 📚 Documentación del Tercer Corte
Toda la documentación semanal, arquitectura, pruebas y guion de sustentación se encuentra en [`documentos/09_Migracion3corte/`](documentos/09_Migracion3corte/).
