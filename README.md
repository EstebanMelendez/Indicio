# Indicio Enterprise (DocuMind)

Plataforma empresarial multi-empresa (*multi-tenant*) de gestión documental inteligente: visión por computador para facturas, automatización contable en código (LangGraph), asistente RAG con memoria (LangChain), ingesta por Gmail y Bot de Telegram propios por empresa, bajo cumplimiento de la Ley 1581 de 2012.

## Componentes

| Capa | Tecnología |
| :--- | :--- |
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | FastAPI (Python 3.11), SQLAlchemy |
| Orquestación IA | LangGraph (Cuentas por Pagar), LangChain (RAG con memoria) |
| Visión | Gemini Flash Vision, Plan B Groq Vision, contingencia local |
| Base de datos | PostgreSQL 16 + pgvector |
| Correo / Mensajería | IMAP/SMTP Gmail (Contraseña de Aplicación), Telegram Bot API |

## Roles y Credenciales por Defecto

| Rol | Correo | Contraseña | Alcance |
| :--- | :--- | :--- | :--- |
| `superadmin` | `AdminEstebanM@gmail.com` | `superadmin123` | Consola global SaaS: crea empresas (`Tenants`) y su administrador inicial |
| `admin` | `indicio.admin@gmail.com` | `admin123` | Gestiona usuarios y auditores de su empresa, enlaza su Gmail y su Bot de Telegram, aprueba y elimina documentos |
| `auditor` | `indicio.auditor@gmail.com` | `auditor123` | Solo lectura y consulta del historial de auditoría (Ley 1581) |
| `user` | `indicio.user@gmail.com` | `user123` | Sube documentos/facturas, valida facturas de baja confianza y usa el asistente RAG |

## Variables de entorno

Copiar la plantilla y completarla:

```bash
cp backend/.env.example backend/.env
```

Ver [`backend/.env.example`](backend/.env.example). Las obligatorias son `DATABASE_URL`, `JWT_SECRET_KEY`, `GEMINI_API_KEY` y las contraseñas iniciales de los usuarios (`SUPERADMIN_PASSWORD`, `ADMIN_PASSWORD`, `AUDITOR_PASSWORD`, `USER_PASSWORD`). `GROQ_API_KEY` activa el Plan B gratuito.

## Instalación local

Requisitos: Python 3.11+, Node.js 20+, Docker Desktop.

```bash
# 1. Base de datos
docker-compose up -d db

# 2. Backend
cd backend
python -m venv venv
venv\Scripts\activate          # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

Al arrancar, el backend crea tablas, la extensión `pgvector`, la organización principal, los usuarios iniciales (con las contraseñas de `.env`) y el trabajo en segundo plano de lectura de Gmail y Bots de Telegram.

## Pruebas

```bash
pytest backend/test_tercer_corte.py -v
```

## Despliegue con Docker

El `Dockerfile` de la raíz compila el frontend y lo sirve junto al backend en un único contenedor:

```bash
docker build -t indicio-enterprise .
docker run -p 8000:8000 --env-file backend/.env indicio-enterprise
```

El servicio expone `/api/health` para comprobación de salud y la interfaz web en `/`.

### Railway

1. Crear un proyecto en Railway desde este repositorio (usa `railway.json` y el `Dockerfile`).
2. Agregar un servicio PostgreSQL con pgvector y definir `DATABASE_URL`.
3. Definir las variables de [`backend/.env.example`](backend/.env.example) en el panel de Railway. `RAILWAY_PUBLIC_DOMAIN` se detecta automáticamente.
4. En `ALLOWED_ORIGINS` colocar la URL pública del servicio.
5. Iniciar sesión con el superusuario y crear cada empresa; cada administrador enlaza su Gmail y su Bot de Telegram en **Usuarios y Roles**.
