# Indicio Enterprise

Indicio Enterprise es una plataforma de gestión documental inteligente. Este repositorio contiene el código fuente completo, incluyendo el frontend, el backend y toda la documentación del ciclo de vida del desarrollo.

## 📂 Estructura del Proyecto

El proyecto está dividido en tres componentes principales:

- **`/backend`**: Contiene la API REST desarrollada en Python (FastAPI). Se encarga de la lógica de negocio, autenticación de usuarios, procesamiento de datos y la conexión con la base de datos PostgreSQL (con soporte para `pgvector`).
- **`/frontend`**: Contiene la interfaz de usuario desarrollada en React y Vite, estilizada con TailwindCSS. Es el portal a través del cual los usuarios interactúan con el sistema.
- **`/documentos`**: Almacena toda la documentación oficial del proyecto, organizada por fases (Análisis, Diseño, Desarrollo, Pruebas, Implementación, Manuales y Trazabilidad).

---

## 🚀 Guía de Instalación y Ejecución

Sigue estos pasos para levantar el entorno de desarrollo en tu máquina local.

### Requisitos Previos
- [Docker](https://www.docker.com/) y Docker Compose
- [Node.js](https://nodejs.org/) (v18 o superior)
- [Python](https://www.python.org/) (v3.10 o superior)

### 1. Levantar la Base de Datos
El proyecto utiliza PostgreSQL. Puedes levantar la base de datos rápidamente usando Docker. Desde la raíz del proyecto, ejecuta:
```bash
docker-compose up -d
```
Esto creará un contenedor llamado `indicio_db` exponiendo el puerto `5432`.

### 2. Configurar y Levantar el Backend
Abre una terminal y navega a la carpeta del backend:
```bash
cd backend
```

Crea y activa un entorno virtual (recomendado):
```bash
python -m venv venv
# En Windows:
venv\Scripts\activate
# En Linux/Mac:
# source venv/bin/activate
```

Instala las dependencias:
```bash
pip install -r requirements.txt
```

Asegúrate de configurar las variables de entorno en el archivo `.env` del backend. Debe incluir al menos la cadena de conexión a la base de datos (`DATABASE_URL`).

**Crear el usuario Administrador:**
Para acceder al sistema por primera vez, necesitas crear el usuario inicial. Ejecuta el script de creación:
```bash
python create_admin.py
```
*Este script conectará con la base de datos y generará (o actualizará) los usuarios con las siguientes credenciales:*

**Administrador:**
- **Email:** `indicio.admin@gmail.com`
- **Contraseña:** `admin123`

**Auditor:**
- **Email:** `indicio.auditor@gmail.com`
- **Contraseña:** `auditor123`

Finalmente, inicia el servidor de desarrollo:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
*(El backend debería estar corriendo en `http://localhost:8000` y accesible desde Docker vía `host.docker.internal`)*

### 3. Configurar y Levantar el Frontend
Abre otra terminal y navega a la carpeta del frontend:
```bash
cd frontend
```

Instala las dependencias del proyecto:
```bash
npm install
```

Inicia el servidor de desarrollo de Vite:
```bash
npm run dev
```
*(El frontend debería estar disponible en `http://localhost:5173`)*

---

## 🤖 Automatización y Flujos de Trabajo (n8n)

Indicio Enterprise utiliza **n8n** (incluido en el `docker-compose.yml` en el puerto `5678`) para automatizar la recepción de documentos vía correo electrónico y el envío de notificaciones.

El flujo de trabajo bidireccional está compuesto por dos flujos (workflows) principales que interactúan con la API de Gmail (OAuth2) y el backend de Indicio:

### 1. Flujo de Ingesta (Gmail ➡️ n8n ➡️ Backend)
Este flujo automatiza la subida de documentos que los usuarios envían por correo.
1. **Trigger de Gmail**: Escucha constantemente la bandeja de entrada buscando correos nuevos que contengan archivos adjuntos.
2. **Nodo de Código (Code)**: Extrae de forma dinámica todos los archivos adjuntos (sin importar cuántos vengan en un solo correo) y los divide en elementos individuales (bajo la llave `documento_individual`).
3. **Nodo de Merge & Login**: n8n se autentica automáticamente en el backend (`/api/auth/login`) usando el usuario de servicio dedicado (`n8n.service@gmail.com`) y combina el token de acceso obtenido con los archivos adjuntos.
4. **Nodo de Upload**: Realiza una petición `POST` a `/api/documents/upload` por cada archivo adjunto, usando el token de autorización. El backend guarda los archivos por defecto en una carpeta del sistema llamada **"Bandeja n8n"** y comienza el análisis de IA en segundo plano.

### 2. Flujo de Notificaciones (Backend ➡️ n8n ➡️ Gmail)
Este flujo se encarga de avisar al usuario cuando el procesamiento de IA ha terminado.
1. **Webhook Trigger**: n8n expone una ruta (`/webhook/document-status`) a la que el backend de FastAPI llama automáticamente cuando termina de clasificar y analizar un documento (ya sea con éxito o si ocurre un error).
2. **Nodo de Gmail (Send)**: Recibe el payload del backend (que incluye `document_id`, `filename`, `status`, `category` y posibles `error_message`) y redacta un correo electrónico de respuesta notificando los resultados del procesamiento.

*(Para que estos flujos funcionen, es necesario configurar las credenciales de la API de Gmail en la consola de Google Cloud y establecer la variable de entorno `N8N_SERVICE_PASSWORD` en el backend para la creación del usuario de servicio usando `python create_n8n_user.py`).*

---

## 🎯 Módulo de Selección y Headhunting IA (Vacantes y Hojas de Vida)

Indicio Enterprise cuenta con un subsistema especializado para el reclutamiento de talento humano y análisis automático de Hojas de Vida (CVs):
1. **Gestión de Vacantes:** Permite publicar ofertas laborales definiendo descripción, requisitos excluyentes, años mínimos de experiencia y competencias técnicas (`required_skills`). Cada vacante es vectorizada semánticamente (vector denso de 768 dimensiones).
2. **Emparejamiento Híbrido Multivacante (Nivel 3):**
   - Cuando se carga una hoja de vida (vía web o correo n8n), el sistema calcula automáticamente la cercanía vectorial contra las vacantes abiertas del inquilino y asigna la más afín.
   - Aplica una fórmula híbrida de evaluación:
     $$\text{Score Final} = (0.65 \times \text{Score Gemini LLM}) + (0.35 \times \text{Score Semántico Coseno})$$
   - Extrae automáticamente: `matched_skills`, `missing_skills`, `experience_gap`, fortalezas (`green_flags`), alertas (`red_flags`) y un resumen técnico de scouting.
3. **Disparador Webhook para RRHH:** Al finalizar el procesamiento de un CV calificado, se dispara un webhook hacia n8n (`/webhook/hr-scouting`) para alertar al equipo de contratación.

---

## 📱 Asistente RAG Móvil por Telegram (@Indicion8n_bot)

Para auditoría y consulta remota desde dispositivos móviles, la plataforma integra un bot oficial de Telegram:
- **Ejecución:**
  ```bash
  cd backend
  venv\Scripts\activate
  python telegram_bot_service.py
  ```
- **Capacidades:** Permite realizar preguntas en lenguaje natural sobre cualquier documento de la empresa (facturas, contratos o candidatos).
- **Arquitectura Resiliente:** El bot consulta prioritariamente el flujo RAG de n8n (`/webhook/telegram-rag`), y ante cualquier desconexión temporal del orquestador, activa automáticamente un fallback directo a la API de FastAPI (`/api/rag/query`) autenticándose con el usuario de servicio.

---

## 🏢 Arquitectura Multi-Inquilino (Multi-Tenant) y Carpetas

- **Aislamiento de Datos:** Cada inquilino (`Tenant`) cuenta con sus propios usuarios, vacantes, carpetas y documentos aislados a nivel relacional en PostgreSQL.
- **Particionado Físico de Archivos:** Las cargas se segregan en disco bajo la ruta estructurada `backend/storage/tenant_{tenant_id}/{filename}` para garantizar privacidad y prevenir colisiones.
- **Carpetas Virtuales:** Organización modular de documentos, incluyendo carpetas creadas por el usuario y carpetas automáticas del sistema (ej. *Bandeja n8n*).

---

## 📝 Documentación del Proyecto

El proyecto dispone de un compendio formal de ingeniería de software en la carpeta `documentos/`:
- **Documento Maestro de Arquitectura y Diseño Actualizado (v2.0):**  
  👉 Consulta [`documentos/02_Diseno/ARQUITECTURA_Y_DISENO_ACTUALIZADO.md`](documentos/02_Diseno/ARQUITECTURA_Y_DISENO_ACTUALIZADO.md) para ver los diagramas Mermaid actualizados, el esquema Entidad-Relación completo, el catálogo de endpoints REST y la memoria técnica detallada.
- **Documentos de Fases (Ciclo de Vida):**
  - `documentos/00_UsoCorrecto/pasos_de_inicio.txt`: Guía rápida de arranque.
  - `documentos/01_Analisis/`: Documento de análisis de requerimientos y casos de uso.
  - `documentos/02_Diseno/`: Especificaciones de arquitectura y base de datos.
  - `documentos/03_Desarrollo/`: Estructura del código y servicios REST.
  - `documentos/04_Pruebas/`: Casos de prueba y matriz de verificación.
  - `documentos/05_Implementacion/`: Guía de despliegue y puesta en marcha.
  - `documentos/06_Manual_Usuario/`: Manual de usuario de la interfaz gráfica.
  - `documentos/07_Manual_Tecnico/`: Manual de administración técnica y mantenimiento.
  - `documentos/08_Trazabilidad/`: Matriz integral de trazabilidad.

## 🤝 Contribución
Al realizar cambios importantes, recuerda actualizar el esquema de base de datos o agregar scripts de migración, así como documentar los nuevos componentes en este README y en la documentación técnica de diseño.
