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

## 📝 Documentación
Puedes encontrar la documentación completa de cada fase del proyecto dentro de la carpeta `documentos/`. Si deseas agregar nuevos archivos, colócalos en su respectiva subcarpeta y súbelos a Git.

## 🤝 Contribución
Al realizar cambios importantes, recuerda actualizar el esquema de base de datos o agregar scripts de migración, así como documentar los nuevos componentes en este README si es necesario.
