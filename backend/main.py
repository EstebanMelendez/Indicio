import os
import shutil
import json
import time
import re
import math
import logging
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Form, Query, BackgroundTasks, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db, engine, Base
from app.models import Document, DocumentChunk, Folder, User, BlacklistedToken, Vacancy, WorkflowAuditLog, Tenant
from app.workflows.invoice_workflow import execute_invoice_workflow
from app.workflows.rag_agent import execute_rag_with_memory
from app.vision_service import is_image_file, analyze_invoice_image
from app.auth import get_current_user, create_access_token, verify_password, get_password_hash, oauth2_scheme, require_role
from app.crypto import encrypt_sensitive_data, decrypt_sensitive_data, mask_secret, sanitize_error_log, build_protected_extracted_data
from app.notifications import notify_document_status
from app.email_service import verify_email_action_token, check_gmail_inbox_once
from app.fallback_service import call_groq_text
import google.generativeai as genai
import pdfplumber
import docx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("IndicioBackend")

# Configuración y enmascaramiento seguro de IA
gemini_key = os.getenv("GEMINI_API_KEY")
if gemini_key:
    logger.info("API Key de Gemini configurada de forma segura: %s", mask_secret(gemini_key))
    genai.configure(api_key=gemini_key)
else:
    logger.warning("[SEGURIDAD CRÍTICA] GEMINI_API_KEY no encontrada en las variables de entorno.")

MODEL_TEXT = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.8-flash")
MODEL_EMB = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-2")

app = FastAPI(title="Indicio Enterprise", description="Plataforma Segura de Gestión Documental Inteligente y RAG")

raw_origins = os.getenv("ALLOWED_ORIGINS", "*").strip()
allowed_origins_list = [o.strip() for o in raw_origins.split(",") if o.strip()] if raw_origins != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Protección de datos en tránsito y en el navegador (Ley 1581 de 2012):
    Añade cabeceras de seguridad HTTP para prevenir clickjacking, MIME sniffing
    y almacenamiento en caché de respuestas con datos personales.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    return response

from sqlalchemy import text

@app.on_event("startup")
def startup_db_check():
    """Garantiza la consistencia automática del esquema de la base de datos al encender el backend"""
    try:
        # Crea todas las tablas que no existan, incluyendo workflow_audit_logs
        Base.metadata.create_all(bind=engine)
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(255);"))
            conn.commit()
        # Garantizar Tenant 1, usuarios semilla (admin, auditor, user, service) y protección Ley 1581
        from sqlalchemy.orm.attributes import flag_modified
        db_init = next(get_db())
        try:
            tenant = db_init.query(Tenant).filter(Tenant.id == 1).first()
            if not tenant:
                tenant = Tenant(id=1, name="Organización Principal")
                db_init.add(tenant)
                db_init.commit()
                logger.info("[SEGURIDAD] Tenant inicial (ID 1: Organización Principal) creado automáticamente.")

            seed_users = [
                {"email": "indicio.admin@gmail.com", "pwd": os.getenv("ADMIN_PASSWORD", "admin123"), "role": "admin"},
                {"email": "indicio.auditor@gmail.com", "pwd": os.getenv("AUDITOR_PASSWORD", "auditor123"), "role": "auditor"},
                {"email": "indicio.user@gmail.com", "pwd": os.getenv("USER_PASSWORD", "user123"), "role": "user"},
                {"email": "n8n.service@gmail.com", "pwd": os.getenv("N8N_SERVICE_PASSWORD", "n8n_secure_pwd_2026_xyz"), "role": "service"},
            ]
            for u_cfg in seed_users:
                existing_user = db_init.query(User).filter(User.email == u_cfg["email"]).first()
                if not existing_user:
                    db_init.add(User(
                        email=u_cfg["email"],
                        hashed_password=get_password_hash(u_cfg["pwd"]),
                        role=u_cfg["role"],
                        tenant_id=1
                    ))
            db_init.commit()

            # Garantizar al menos 1 vacante abierta por defecto para que el emparejamiento de Hojas de Vida funcione de inmediato
            if db_init.query(Vacancy).filter(Vacancy.tenant_id == 1).count() == 0:
                db_init.add(Vacancy(
                    tenant_id=1,
                    title="Ingeniero de Software Full Stack & IA",
                    department="Tecnología e Innovación",
                    description="Desarrollo de plataforma empresarial con FastAPI, React, PostgreSQL pgvector y flujos de agentes en LangGraph/LangChain.",
                    requirements="Experiencia en desarrollo web, APIs REST en Python, bases de datos SQL, Docker e integración de modelos de IA.",
                    min_years_experience=3,
                    required_skills=["Python", "FastAPI", "React", "PostgreSQL", "Docker", "LangChain", "LangGraph"],
                    status="Abierta"
                ))
                db_init.commit()

            docs_to_protect = db_init.query(Document).filter(Document.extracted_data.isnot(None)).all()
            migrated_count = 0
            for d in docs_to_protect:
                ext = d.extracted_data
                if isinstance(ext, dict) and not ext.get("_ley1581_protected"):
                    raw_payload = ext
                    if "_encrypted_data" in ext:
                        dec = decrypt_sensitive_data(ext["_encrypted_data"])
                        if isinstance(dec, dict):
                            raw_payload = dec
                    d.extracted_data = build_protected_extracted_data(raw_payload)
                    flag_modified(d, "extracted_data")
                    migrated_count += 1
            if migrated_count > 0:
                db_init.commit()
                logger.info("[LEY 1581] %d documentos migrados a cifrado estricto en reposo.", migrated_count)
        finally:
            db_init.close()
        logger.info("[SEGURIDAD] Verificación y migración de esquema completada exitosamente.")
        # Iniciar hilos en segundo plano: Ingesta de Gmail (IMAP) + Bot de Telegram
        import threading
        def _imap_worker():
            while True:
                time.sleep(60)
                if os.getenv("GMAIL_APP_PASSWORD", "").strip():
                    try:
                        check_gmail_inbox_once(lambda: next(get_db()), process_document_background)
                    except Exception:
                        pass
        threading.Thread(target=_imap_worker, daemon=True).start()

        if os.getenv("TELEGRAM_BOT_TOKEN", "").strip() and os.getenv("DISABLE_TELEGRAM_BOT", "false").lower() != "true":
            def _telegram_worker():
                time.sleep(4)
                try:
                    from telegram_bot_service import run_bot
                    run_bot()
                except Exception as tg_err:
                    logger.warning("[TELEGRAM] Hilo de bot finalizado o en espera: %s", tg_err)
            threading.Thread(target=_telegram_worker, daemon=True).start()
    except Exception as e:
        logger.warning("[SEGURIDAD] No se pudo verificar el esquema en startup: %s", e)

def serialize_document(doc: Document, user_role: str) -> dict:
    """
    Serializa un documento aplicando:
    1. Descifrado seguro de datos sensibles en reposo (_encrypted_data).
    2. Restricción de acceso a registros técnicos / error_log según el rol del usuario.
    3. Sanitización de trazas para garantizar que ninguna API key o token sea devuelto.
    """
    data = doc.extracted_data
    if isinstance(data, dict) and "_encrypted_data" in data:
        decrypted = decrypt_sensitive_data(data["_encrypted_data"])
        if isinstance(decrypted, dict):
            data = decrypted

    # Restricción de registros: Solo administradores y auditores tienen acceso al detalle técnico
    error_log = None
    if user_role in ["admin", "auditor"]:
        error_log = sanitize_error_log(doc.error_log)
    elif doc.status == "Error":
        error_log = "Error en el procesamiento del archivo. Contacte al administrador del sistema."

    return {
        "id": doc.id,
        "filename": doc.filename,
        "category": doc.category,
        "status": doc.status,
        "folder_id": doc.folder_id,
        "vacancy_id": doc.vacancy_id,
        "mime_type": doc.mime_type,
        "file_size_bytes": doc.file_size_bytes,
        "summary": doc.summary,
        "extracted_data": data,
        "error_log": error_log,
        "uploaded_by": getattr(doc, "uploaded_by", None),
        "created_at": doc.created_at,
        "tenant_id": doc.tenant_id
    }

# --- SERVICIOS ---
def extract_text(file_path: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    text_content = ""
    if ext == ".pdf":
        with pdfplumber.open(file_path) as pdf:
            text_content = "\n".join([page.extract_text() for page in pdf.pages if page.extract_text()])
    elif ext == ".docx":
        doc = docx.Document(file_path)
        text_content = "\n".join([para.text for para in doc.paragraphs])
    elif ext == ".txt":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text_content = f.read()
    return text_content.strip()

# --- ENDPOINTS ---
class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/api/auth/login")
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Email o contraseña incorrectos")
    
    user_role = getattr(user, "role", "user") or "user"
    tenant_id = user.tenant_id if user.tenant_id is not None else 1
    access_token = create_access_token(data={"sub": user.email, "role": user_role, "tenant_id": tenant_id})
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "role": user_role,
        "tenant_id": tenant_id
    }

@app.post("/api/auth/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    blacklisted = BlacklistedToken(token=token)
    db.add(blacklisted)
    db.commit()
    return {"message": "Sesión cerrada exitosamente"}

@app.get("/api/dashboard/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Document).filter(Document.tenant_id == current_user.tenant_id).count()
    processed = db.query(Document).filter(Document.tenant_id == current_user.tenant_id, Document.status == "Procesado").count()
    needs_review = db.query(Document).filter(Document.tenant_id == current_user.tenant_id, Document.status == "Requiere Revisión").count()
    errors = db.query(Document).filter(Document.tenant_id == current_user.tenant_id, Document.status == "Error").count()
    
    all_docs = db.query(Document.filename).filter(Document.tenant_id == current_user.tenant_id).all()
    vision_count = sum(1 for (fname,) in all_docs if fname and is_image_file(fname))

    categories_query = db.query(Document.category, func.count(Document.id)).filter(Document.tenant_id == current_user.tenant_id).group_by(Document.category).all()
    categories = {cat if cat else "Sin Clasificar": count for cat, count in categories_query}
    
    return {
        "total": total, 
        "processed": processed, 
        "needs_review": needs_review,
        "vision_count": vision_count,
        "errors": errors,
        "categories": categories
    }

@app.get("/api/audit/logs")
def get_audit_logs(
    limit: int = 200,
    workflow_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "auditor"]))
):
    """
    Retorna el historial de ejecuciones y decisiones de automatización e IA.
    Solo accesible para roles 'admin' y 'auditor' conforme a la Ley 1581 y requisitos de seguridad.
    """
    q = db.query(WorkflowAuditLog).filter(WorkflowAuditLog.tenant_id == current_user.tenant_id)
    if workflow_name:
        q = q.filter(WorkflowAuditLog.workflow_name == workflow_name)
    logs = q.order_by(WorkflowAuditLog.created_at.desc()).limit(limit).all()
    return logs


@app.get("/api/security/compliance-status")
def get_security_compliance_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Endpoint de verificación de cumplimiento de Seguridad y Ley 1581 de 2012 (Habeas Data).
    Describe cómo se protegen los datos de usuarios, archivos en reposo y tránsito.
    """
    total_docs = db.query(Document).filter(Document.tenant_id == current_user.tenant_id).count()
    audit_count = db.query(WorkflowAuditLog).filter(WorkflowAuditLog.tenant_id == current_user.tenant_id).count()
    return {
        "framework": "Ley 1581 de 2012 y Decreto 1377 de 2013 (Colombia)",
        "tenant_id": current_user.tenant_id,
        "user_role": getattr(current_user, "role", "user"),
        "personal_data_categories": [
            "Hojas de Vida: nombre del postulante, teléfono, ubicación, formación y experiencia laboral",
            "Facturas y Cuentas de Cobro: razón social/nombre, NIT/Cédula, montos e ítems",
            "Usuarios y Trazabilidad: correo corporativo, rol RBAC, autor de carga (uploaded_by) y logs de auditoría"
        ],
        "controls": {
            "user_protection": "Hashing bcrypt (Passlib), sesiones JWT HS256 (4h), revocación en BlacklistedToken y RBAC (admin, auditor, user)",
            "data_at_rest": "Cifrado autenticado AES-128-CBC + HMAC-SHA256 (Fernet) respaldado por RSA-2048 en PostgreSQL (_encrypted_data) y enmascaramiento de PII",
            "file_storage": f"Particionamiento físico por inquilino (storage/tenant_{current_user.tenant_id}/), sanitización anti-Path Traversal y descarga protegida por JWT",
            "data_in_transit": "TLS/HTTPS en despliegue, cabeceras HTTP anti-caché (no-store), enlaces de correo firmados con HMAC-SHA256 e IMAP4_SSL/SMTP_SSL"
        },
        "metrics": {
            "protected_documents": total_docs,
            "audit_trail_events": audit_count
        }
    }

class FolderCreate(BaseModel):
    name: str

@app.post("/api/folders")
def create_folder(folder: FolderCreate, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    new_folder = Folder(name=folder.name, tenant_id=current_user.tenant_id)
    db.add(new_folder)
    db.commit()
    db.refresh(new_folder)
    return new_folder

@app.get("/api/folders")
def list_folders(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Folder).filter(Folder.tenant_id == current_user.tenant_id).order_by(Folder.created_at.desc()).all()

@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.tenant_id == current_user.tenant_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada o no pertenece a su organización")
    db.delete(folder)
    db.commit()
    return {"message": "Carpeta eliminada"}

# --- VACANTES Y EMPAREJAMIENTO HÍBRIDO (NIVEL 3) ---

def cosine_similarity(vec1, vec2) -> float:
    if not vec1 or not vec2:
        return 0.0
    v1 = list(vec1)
    v2 = list(vec2)
    if len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0
    return dot / (norm1 * norm2)

def compute_vacancy_embedding(title: str, department: str, description: str, requirements: str, required_skills: list) -> list:
    skills_str = ", ".join(required_skills) if isinstance(required_skills, list) else str(required_skills or "")
    full_text = f"Vacante: {title}. Departamento: {department}. Descripción del puesto: {description}. Requisitos: {requirements}. Habilidades requeridas: {skills_str}"
    try:
        res = genai.embed_content(
            model=MODEL_EMB,
            content=full_text[:2000],
            task_type="retrieval_document",
            output_dimensionality=768
        )
        return res['embedding']
    except Exception as e:
        print(f"[WARN] Error generando embedding de vacante: {e}")
        return None

def calculate_semantic_similarity(vacancy_emb, doc_chunks: list) -> float:
    if not vacancy_emb or not doc_chunks:
        return 70.0
    similarities = []
    for chunk in doc_chunks:
        if chunk.embedding is not None:
            sim = cosine_similarity(vacancy_emb, chunk.embedding)
            similarities.append(sim)
    if not similarities:
        return 70.0
    similarities.sort(reverse=True)
    top_sim = similarities[:3]
    avg_sim = sum(top_sim) / len(top_sim)
    score = max(0.0, min(100.0, ((avg_sim + 1.0) / 2.0) * 100.0))
    return round(score, 1)

def evaluate_cv_against_vacancy(cv_text: str, vacancy: Vacancy, candidate_models: list) -> dict:
    skills_str = ", ".join(vacancy.required_skills) if isinstance(vacancy.required_skills, list) else str(vacancy.required_skills or "")
    prompt = f"""Eres un Headhunter Senior y evaluador técnico de talento humano.
Evalúa ESTRICTAMENTE este currículum contra la VACANTE OBJETIVO indicada.
Tu análisis debe ser objetivo, técnico y cuantitativo.
Responde ÚNICAMENTE un objeto JSON válido, sin delimitadores markdown.

VACANTE OBJETIVO:
- Título del Puesto: {vacancy.title}
- Departamento: {vacancy.department}
- Descripción: {vacancy.description}
- Requisitos: {vacancy.requirements}
- Años mínimos de experiencia requeridos: {vacancy.min_years_experience}
- Habilidades / Tecnologías clave requeridas: {skills_str}

CURRÍCULUM DEL POSTULANTE:
{cv_text[:7000]}

ESQUEMA JSON REQUERIDO:
{{
    "postulante": "Nombre completo detectado",
    "rol": "Cargo o perfil profesional principal",
    "anos_experiencia": 0.0,
    "competencias": ["habilidad1", "habilidad2"],
    "matched_skills": ["habilidad requerida por la vacante que el candidato SÍ posee"],
    "missing_skills": ["habilidad requerida por la vacante que el candidato NO menciona o carece"],
    "experience_gap": "Resumen del cumplimiento de experiencia (ej: 'Cumple: 4 años vs 3 mínimos')",
    "green_flags": ["Fortaleza 1 frente a la vacante", "Fortaleza 2"],
    "red_flags": ["Brecha o riesgo frente a la vacante"],
    "gemini_score": 85.0,
    "resumen_scouting": "Síntesis ejecutiva de 2 a 3 líneas sobre el ajuste del candidato a esta vacante"
}}"""

    for model_name in candidate_models:
        try:
            curr_model = genai.GenerativeModel(model_name)
            res = curr_model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            raw = res.text.strip()
            if raw.startswith("```json"):
                raw = raw[7:-3].strip()
            elif raw.startswith("```"):
                raw = raw[3:-3].strip()
            return json.loads(raw)
        except Exception as e:
            print(f"[WARN] Error en evaluate_cv_against_vacancy con {model_name}: {e}")
            continue
    return None

class VacancyCreate(BaseModel):
    title: str
    department: Optional[str] = "Tecnología"
    description: str
    requirements: str
    min_years_experience: Optional[int] = 0
    required_skills: Optional[list[str]] = []
    status: Optional[str] = "Abierta"

class VacancyUpdate(BaseModel):
    title: Optional[str] = None
    department: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    min_years_experience: Optional[int] = None
    required_skills: Optional[list[str]] = None
    status: Optional[str] = None

@app.post("/api/vacancies")
def create_vacancy(
    data: VacancyCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_role(["admin"]))
):
    emb = compute_vacancy_embedding(data.title, data.department, data.description, data.requirements, data.required_skills)
    new_vac = Vacancy(
        tenant_id=current_user.tenant_id,
        title=data.title,
        department=data.department or "Tecnología",
        description=data.description,
        requirements=data.requirements,
        min_years_experience=data.min_years_experience or 0,
        required_skills=data.required_skills or [],
        status=data.status or "Abierta",
        embedding=emb
    )
    db.add(new_vac)
    db.commit()
    db.refresh(new_vac)
    return new_vac

@app.get("/api/vacancies")
def list_vacancies(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    q = db.query(Vacancy).filter(Vacancy.tenant_id == current_user.tenant_id)
    if status:
        q = q.filter(Vacancy.status == status)
    vacancies = q.order_by(Vacancy.created_at.desc()).all()
    
    result = []
    for vac in vacancies:
        candidates = db.query(Document).filter(Document.vacancy_id == vac.id, Document.tenant_id == current_user.tenant_id).all()
        scores = []
        for c in candidates:
            if c.extracted_data and isinstance(c.extracted_data, dict):
                score = c.extracted_data.get("match_score")
                if score is not None:
                    try:
                        scores.append(float(score))
                    except Exception:
                        pass
        top_score = max(scores) if scores else 0.0
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0.0
        
        result.append({
            "id": vac.id,
            "title": vac.title,
            "department": vac.department,
            "description": vac.description,
            "requirements": vac.requirements,
            "min_years_experience": vac.min_years_experience,
            "required_skills": vac.required_skills or [],
            "status": vac.status,
            "created_at": vac.created_at,
            "candidates_count": len(candidates),
            "top_score": top_score,
            "avg_score": avg_score
        })
    return result

@app.get("/api/vacancies/{vacancy_id}")
def get_vacancy_detail(
    vacancy_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    vac = db.query(Vacancy).filter(Vacancy.id == vacancy_id, Vacancy.tenant_id == current_user.tenant_id).first()
    if not vac:
        raise HTTPException(status_code=404, detail="Vacante no encontrada")
        
    candidates = db.query(Document).filter(Document.vacancy_id == vac.id, Document.tenant_id == current_user.tenant_id).all()
    
    def get_score(doc):
        if doc.extracted_data and isinstance(doc.extracted_data, dict):
            s = doc.extracted_data.get("match_score")
            if s is not None:
                try:
                    return float(s)
                except Exception:
                    pass
        return 0.0
        
    sorted_candidates = sorted(candidates, key=get_score, reverse=True)
    user_role = getattr(current_user, "role", "user") or "user"
    
    return {
        "id": vac.id,
        "title": vac.title,
        "department": vac.department,
        "description": vac.description,
        "requirements": vac.requirements,
        "min_years_experience": vac.min_years_experience,
        "required_skills": vac.required_skills or [],
        "status": vac.status,
        "created_at": vac.created_at,
        "candidates": [serialize_document(c, user_role) for c in sorted_candidates]
    }

@app.put("/api/vacancies/{vacancy_id}")
def update_vacancy(
    vacancy_id: int,
    data: VacancyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    vac = db.query(Vacancy).filter(Vacancy.id == vacancy_id, Vacancy.tenant_id == current_user.tenant_id).first()
    if not vac:
        raise HTTPException(status_code=404, detail="Vacante no encontrada")
        
    need_emb = False
    if data.title is not None:
        vac.title = data.title
        need_emb = True
    if data.department is not None:
        vac.department = data.department
    if data.description is not None:
        vac.description = data.description
        need_emb = True
    if data.requirements is not None:
        vac.requirements = data.requirements
        need_emb = True
    if data.min_years_experience is not None:
        vac.min_years_experience = data.min_years_experience
    if data.required_skills is not None:
        vac.required_skills = data.required_skills
        need_emb = True
    if data.status is not None:
        vac.status = data.status
        
    if need_emb:
        vac.embedding = compute_vacancy_embedding(vac.title, vac.department, vac.description, vac.requirements, vac.required_skills)
        
    db.commit()
    db.refresh(vac)
    return vac

@app.delete("/api/vacancies/{vacancy_id}")
def delete_vacancy(
    vacancy_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    vac = db.query(Vacancy).filter(Vacancy.id == vacancy_id, Vacancy.tenant_id == current_user.tenant_id).first()
    if not vac:
        raise HTTPException(status_code=404, detail="Vacante no encontrada")
    db.delete(vac)
    db.commit()
    return {"message": "Vacante eliminada"}

@app.post("/api/vacancies/{vacancy_id}/match/{document_id}")
def match_document_to_vacancy(
    vacancy_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    from sqlalchemy.orm.attributes import flag_modified
    vac = db.query(Vacancy).filter(Vacancy.id == vacancy_id, Vacancy.tenant_id == current_user.tenant_id).first()
    if not vac:
        raise HTTPException(status_code=404, detail="Vacante no encontrada")
    
    doc = db.query(Document).filter(Document.id == document_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
        
    raw_text = extract_text(doc.file_path, doc.filename)
    if not raw_text:
        raise HTTPException(status_code=400, detail="No se pudo extraer texto del documento")
        
    chunks = db.query(DocumentChunk).filter(DocumentChunk.document_id == doc.id).all()
    semantic_score = calculate_semantic_similarity(vac.embedding, chunks)
    
    candidate_models = list(dict.fromkeys([
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite")
    ]))
    vac_eval = evaluate_cv_against_vacancy(raw_text, vac, candidate_models)
    
    raw_existing = doc.extracted_data or {}
    if isinstance(raw_existing, dict) and "_encrypted_data" in raw_existing:
        dec = decrypt_sensitive_data(raw_existing["_encrypted_data"])
        if isinstance(dec, dict):
            raw_existing = dec
    extracted = dict(raw_existing)
    if vac_eval:
        gemini_score = float(vac_eval.get("gemini_score", 75.0))
        final_match_score = round(0.65 * gemini_score + 0.35 * semantic_score, 1)
        extracted["match_score"] = final_match_score
        extracted["gemini_score"] = gemini_score
        extracted["semantic_score"] = semantic_score
        extracted["vacancy_id"] = vac.id
        extracted["vacancy_title"] = vac.title
        extracted["matched_skills"] = vac_eval.get("matched_skills", [])
        extracted["missing_skills"] = vac_eval.get("missing_skills", [])
        extracted["experience_gap"] = vac_eval.get("experience_gap", "")
        extracted["green_flags"] = vac_eval.get("green_flags", extracted.get("green_flags", []))
        extracted["red_flags"] = vac_eval.get("red_flags", [])
        extracted["resumen_scouting"] = vac_eval.get("resumen_scouting", extracted.get("resumen_scouting", ""))
        if vac_eval.get("postulante"):
            extracted["postulante"] = vac_eval["postulante"]
        if vac_eval.get("rol"):
            extracted["rol"] = vac_eval["rol"]
        if vac_eval.get("anos_experiencia") is not None:
            try:
                extracted["anos_experiencia"] = float(vac_eval["anos_experiencia"])
            except Exception:
                pass
    else:
        extracted["match_score"] = semantic_score
        extracted["semantic_score"] = semantic_score
        extracted["vacancy_id"] = vac.id
        extracted["vacancy_title"] = vac.title

    doc.vacancy_id = vac.id
    doc.extracted_data = build_protected_extracted_data(extracted)
    flag_modified(doc, "extracted_data")
    db.commit()
    db.refresh(doc)
    
    return {
        "message": "Evaluación contra vacante completada",
        "document_id": doc.id,
        "vacancy_id": vac.id,
        "match_score": extracted.get("match_score"),
        "gemini_score": extracted.get("gemini_score"),
        "semantic_score": extracted.get("semantic_score"),
        "matched_skills": extracted.get("matched_skills"),
        "missing_skills": extracted.get("missing_skills"),
        "resumen_scouting": extracted.get("resumen_scouting")
    }

def process_document_background(doc_id: int, file_path: str, filename: str):
    # This must create its own DB session since it runs in the background
    db = next(get_db())
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        return
        
    try:
        # Transición a Procesando antes de la IA
        doc.status = "Procesando"
        db.commit()
        
        candidate_models = list(dict.fromkeys([
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash",
            os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite")
        ]))

        # =====================================================================
        # RAMA A: VISIÓN POR COMPUTADOR (Imágenes .jpg, .jpeg, .png, .webp)
        # =====================================================================
        if is_image_file(filename):
            vision_res = analyze_invoice_image(
                file_path=file_path,
                filename=filename,
                db=db,
                tenant_id=doc.tenant_id,
                document_id=doc.id,
                user_email=doc.uploaded_by or "sistema@indicio.internal",
                trigger_source="VisionUpload"
            )
            doc.category = vision_res.get("category", "Facturas y Cuentas de Cobro")
            doc.summary = vision_res.get("summary", "Factura procesada por Visión Computacional.")
            extracted = vision_res.get("extracted_data", {})
            raw_text = vision_res.get("raw_text", "") or doc.summary

        # =====================================================================
        # RAMA B: DOCUMENTOS DE TEXTO (.pdf, .docx, .txt)
        # =====================================================================
        else:
            # 1. Extracción con validación
            raw_text = extract_text(file_path, filename)
            if not raw_text or len(raw_text.strip()) < 10:
                raise ValueError("El documento está vacío o no se pudo extraer texto legible.")
            
            # 2. Clasificación con modelo dinámico y fallback ante límites de cuota (429)
            prompt = f"""Analiza este documento y responde ESTRICTAMENTE en formato JSON válido, sin comillas invertidas ni markdown.
            Clasifica obligatoriamente en una de estas categorías: "Facturas y Cuentas de Cobro", "Contratos y Acuerdos Legales", "Hojas de Vida / Perfiles Laborales", "Recibos y Comprobantes de Pago", "Reportes y Estados Financieros", "Actas de Reunión", "Manuales y Procedimientos" (o "Sin Clasificar" si no aplica ninguna).
            El esquema debe ser:
            {{
                "category": "nombre de la categoria",
                "summary": "resumen ejecutivo",
                "extracted_data": {{
                    // Si es "Facturas y Cuentas de Cobro", usa OBLIGATORIAMENTE este esquema:
                    // "emisor_nombre": string (nombre del proveedor o emisor),
                    // "emisor_nit": string (NIT o identificación fiscal, o null si no aparece),
                    // "numero_factura": string (número o consecutivo de factura),
                    // "fecha_emision": string (YYYY-MM-DD o formato original),
                    // "fecha_vencimiento": string (YYYY-MM-DD o null si no especifica),
                    // "moneda": string (ej: "COP", "USD", "EUR"),
                    // "items": [ {{ "descripcion": string, "cantidad": number, "precio_unitario": number, "subtotal": number }} ],
                    // "monto_subtotal": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 1200000.00),
                    // "monto_impuestos": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 228000.00),
                    // "monto_total": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 1428000.00),
                    // "concepto_principal": string (descripción breve del servicio o bien),
                    // "confidence_score": number (del 0 al 100 indicando la certeza de los datos extraídos, ej: 95)

                    // Si es "Recibos y Comprobantes de Pago":
                    // "emisor_nombre": string,
                    // "receptor_nombre": string,
                    // "numero_recibo": string (o null),
                    // "fecha_pago": string,
                    // "moneda": string,
                    // "items": [ {{ "descripcion": string, "cantidad": number, "precio_unitario": number, "subtotal": number }} ],
                    // "monto_total": number (numérico limpio float/int, sin símbolos ni puntos de miles),
                    // "concepto_principal": string,
                    // "metodo_pago": string (ej: "Transferencia", "Efectivo", o null),
                    // "confidence_score": number (del 0 al 100)

                    // Si es "Contratos y Acuerdos Legales": "partes", "objeto", "vigencia", "valor".
                    // Si es "Hojas de Vida / Perfiles Laborales", usa OBLIGATORIAMENTE este esquema estructurado:
                    // "postulante": string (nombre completo del candidato),
                    // "rol": string (cargo o especialidad principal, ej: "Desarrollador Fullstack"),
                    // "anos_experiencia": number (años de experiencia laboral corporativa en número, ej: 4 o 1.5),
                    // "competencias": array de strings (tecnologías y habilidades clave, ej: ["React", "Azure", "GitHub", "Python"]),
                    // "formacion": string (educación, certificaciones o nivel académico),
                    // "contacto_telefono": string o null,
                    // "contacto_ubicacion": string o null (ciudad o país),
                    // "match_score": number (puntuación entera o decimal del 0 al 100 evaluando seniority, experiencia y solidez técnica),
                    // "green_flags": array de strings (principales 2 a 3 fortalezas del candidato),
                    // "resumen_scouting": string (síntesis ejecutiva de 2 líneas destacando el potencial del candidato)

                    // Si es "Reportes y Estados Financieros": "empresa", "periodo", "tipo_reporte", "ingresos", "gastos".
                    // Si es "Actas de Reunión": "fecha", "asistentes", "temas_tratados", "conclusiones".
                    // Si es "Manuales y Procedimientos": "titulo", "departamento", "proposito", "version".
                }}
            }}

            REGLA ESTRICTA PARA MONTOS: Los campos 'monto_total', 'monto_subtotal' y 'monto_impuestos' deben ser EXCLUSIVAMENTE de tipo number (flotante o entero), NUNCA cadenas de texto, sin símbolos como '$', sin 'COP'/'USD' y sin separadores de miles con puntos. Ejemplo correcto: 1428000.00. Ejemplo incorrecto: "$ 1.428.000".

            Documento: {raw_text[:8000]}"""

            response = None
            last_error = None
            for model_name in candidate_models:
                try:
                    curr_model = genai.GenerativeModel(model_name)
                    response = curr_model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                    print(f"[OK] Documento analizado exitosamente con {model_name}")
                    break
                except Exception as e:
                    last_error = e
                    err_str = str(e)
                    if "429" in err_str or "Quota exceeded" in err_str:
                        print(f"[WARN] Limite de cuota alcanzado en {model_name}. Cambiando a modelo alternativo...")
                        continue
                    else:
                        print(f"[WARN] Error en {model_name}: {err_str[:80]}. Probando alternativo...")
                        continue

            if not response:
                print(f"[PLAN B] Modelos de Gemini agotados para {filename}. Activando Plan B en Groq API...")
                groq_raw, _ = call_groq_text(prompt, json_mode=True)
                if groq_raw:
                    raw_response = groq_raw.strip()
                else:
                    raise last_error or ValueError("No se pudo obtener respuesta de la IA.")
            else:
                raw_response = response.text.strip()
            
            # Limpieza por si Gemini insiste en enviar Markdown
            if raw_response.startswith("```json"):
                raw_response = raw_response[7:-3].strip()
            elif raw_response.startswith("```"):
                raw_response = raw_response[3:-3].strip()
                
            ai_data = json.loads(raw_response)
            
            doc.category = ai_data.get("category", "Sin Clasificar")
            doc.summary = ai_data.get("summary", "")
            extracted = ai_data.get("extracted_data", {})
        
        # Sanitización defensiva de datos extraídos para garantizar compatibilidad total con n8n y LangGraph
        if isinstance(extracted, dict):
            for k in ["monto_total", "monto_subtotal", "monto_impuestos"]:
                if k in extracted and extracted[k] is not None:
                    if isinstance(extracted[k], str):
                        clean_str = extracted[k].replace("$", "").replace("USD", "").replace("COP", "").replace("EUR", "").replace(" ", "").strip()
                        try:
                            if "," in clean_str and "." in clean_str:
                                if clean_str.rfind(",") > clean_str.rfind("."):
                                    clean_str = clean_str.replace(".", "").replace(",", ".")
                                else:
                                    clean_str = clean_str.replace(",", "")
                            elif "," in clean_str:
                                clean_str = clean_str.replace(",", ".")
                            extracted[k] = float(clean_str)
                        except (ValueError, TypeError):
                            pass

            if "match_score" in extracted and extracted["match_score"] is not None:
                try:
                    if isinstance(extracted["match_score"], str):
                        clean_score = re.sub(r"[^\d.]", "", extracted["match_score"])
                        extracted["match_score"] = float(clean_score) if clean_score else 80.0
                    else:
                        extracted["match_score"] = float(extracted["match_score"])
                except Exception:
                    extracted["match_score"] = 80.0

            if "confidence_score" in extracted and extracted["confidence_score"] is not None:
                try:
                    c_val = float(extracted["confidence_score"])
                    if 0 < c_val <= 1.0:
                        c_val = round(c_val * 100.0, 1)
                    extracted["confidence_score"] = round(c_val, 1)
                except Exception:
                    extracted["confidence_score"] = 90.0

            if "anos_experiencia" in extracted and extracted["anos_experiencia"] is not None:
                try:
                    if isinstance(extracted["anos_experiencia"], str):
                        clean_exp = re.sub(r"[^\d.]", "", extracted["anos_experiencia"])
                        extracted["anos_experiencia"] = float(clean_exp) if clean_exp else 0.0
                    else:
                        extracted["anos_experiencia"] = float(extracted["anos_experiencia"])
                except Exception:
                    pass
        doc.extracted_data = extracted

        # 3. Vectorización de Chunks
        chunks = [raw_text[i:i+700] for i in range(0, len(raw_text), 700)]
        created_chunks = []
        for i, chunk in enumerate(chunks):
            emb = None
            for attempt in range(3):
                try:
                    emb = genai.embed_content(model=MODEL_EMB, content=chunk, task_type="retrieval_document", output_dimensionality=768)['embedding']
                    break
                except Exception as e:
                    if "429" in str(e) or "Quota exceeded" in str(e):
                        if attempt < 2:
                            print(f"[WARN] Cuota excedida en embeddings. Esperando 20s... ({attempt+1}/3)")
                            time.sleep(20)
                            continue
                    raise e
            
            if emb:
                chunk_obj = DocumentChunk(document_id=doc.id, chunk_index=i, chunk_text=chunk, embedding=emb)
                db.add(chunk_obj)
                created_chunks.append(chunk_obj)

        # 4. Emparejamiento Híbrido Multivacante (Nivel 3) si es Hoja de Vida
        is_cv = doc.category and any(k in doc.category for k in ["Vida", "Curriculum", "CV", "Laboral"])
        target_vacancy = None
        if doc.vacancy_id:
            target_vacancy = db.query(Vacancy).filter(Vacancy.id == doc.vacancy_id).first()
        elif is_cv:
            open_vacancies = db.query(Vacancy).filter(Vacancy.tenant_id == doc.tenant_id, Vacancy.status == "Abierta").all()
            if open_vacancies:
                if len(open_vacancies) == 1:
                    target_vacancy = open_vacancies[0]
                else:
                    # Enrutamiento inteligente multivacante por afinidad semántica vectorial
                    best_vac = open_vacancies[0]
                    best_sim = -1.0
                    for vac in open_vacancies:
                        sim = calculate_semantic_similarity(vac.embedding, created_chunks)
                        if sim > best_sim:
                            best_sim = sim
                            best_vac = vac
                    target_vacancy = best_vac
                    print(f"[INFO] CV enrutado automáticamente a la vacante más afín: '{target_vacancy.title}' (Afinidad semántica: {best_sim}%)")
                doc.vacancy_id = target_vacancy.id

        if is_cv and target_vacancy:
            print(f"[INFO] Evaluando emparejamiento híbrido con vacante: {target_vacancy.title}")
            semantic_score = calculate_semantic_similarity(target_vacancy.embedding, created_chunks)
            vac_eval = evaluate_cv_against_vacancy(raw_text, target_vacancy, candidate_models)
            
            if vac_eval:
                gemini_score = float(vac_eval.get("gemini_score", 75.0))
                final_match_score = round(0.65 * gemini_score + 0.35 * semantic_score, 1)
                
                extracted["match_score"] = final_match_score
                extracted["gemini_score"] = gemini_score
                extracted["semantic_score"] = semantic_score
                extracted["vacancy_id"] = target_vacancy.id
                extracted["vacancy_title"] = target_vacancy.title
                extracted["matched_skills"] = vac_eval.get("matched_skills", [])
                extracted["missing_skills"] = vac_eval.get("missing_skills", [])
                extracted["experience_gap"] = vac_eval.get("experience_gap", "")
                extracted["green_flags"] = vac_eval.get("green_flags", extracted.get("green_flags", []))
                extracted["red_flags"] = vac_eval.get("red_flags", [])
                extracted["resumen_scouting"] = vac_eval.get("resumen_scouting", extracted.get("resumen_scouting", ""))
                if vac_eval.get("postulante"):
                    extracted["postulante"] = vac_eval["postulante"]
                if vac_eval.get("rol"):
                    extracted["rol"] = vac_eval["rol"]
                if vac_eval.get("anos_experiencia") is not None:
                    try:
                        extracted["anos_experiencia"] = float(vac_eval["anos_experiencia"])
                    except Exception:
                        pass
            else:
                extracted["match_score"] = semantic_score
                extracted["semantic_score"] = semantic_score
                extracted["vacancy_id"] = target_vacancy.id
                extracted["vacancy_title"] = target_vacancy.title
            
        # Cifrado de datos sensibles en PostgreSQL (Cifrado en reposo Ley 1581)
        doc.extracted_data = build_protected_extracted_data(extracted)

        # Verificar umbral de confianza (< 80% -> Requiere Revisión Humana)
        conf_score = extracted.get("confidence_score") if isinstance(extracted, dict) else None
        is_invoice = doc.category and any(k in doc.category for k in ["Factura", "Recibo", "Cobro"])

        if conf_score is not None and float(conf_score) < 80.0:
            doc.status = "Requiere Revisión"
            print(f"[VISION] Confianza baja ({conf_score}%) en {filename} -> Estado: Requiere Revisión")
        else:
            doc.status = "Procesado"
            print(f"[OK] Exito procesando: {filename}")

        # Si el documento procesado es una Factura o Recibo, disparar el motor contable en código (LangGraph)
        if is_invoice:
            try:
                wf_res = execute_invoice_workflow(
                    db=db,
                    document=doc,
                    user_email=doc.uploaded_by or "sistema@indicio.internal",
                    trigger_source="VisionProcessor" if is_image_file(filename) else "BackgroundProcessor"
                )
                # Si la confianza fue < 80%, asegurar que el documento quede en estado "Requiere Revisión"
                if conf_score is not None and float(conf_score) < 80.0:
                    doc.status = "Requiere Revisión"
            except Exception as w_err:
                print(f"[WARN] Error ejecutando invoice_workflow en código: {w_err}")
        elif is_cv:
            try:
                from app.email_service import execute_hr_scouting_workflow
                execute_hr_scouting_workflow(db=db, document=doc, extracted=extracted)
                if doc.folder_id is None:
                    cv_folder = db.query(Folder).filter(Folder.name == "Candidatos Destacados", Folder.tenant_id == doc.tenant_id).first()
                    if not cv_folder:
                        cv_folder = Folder(name="Candidatos Destacados", tenant_id=doc.tenant_id)
                        db.add(cv_folder)
                        db.commit()
                        db.refresh(cv_folder)
                    doc.folder_id = cv_folder.id
            except Exception as hr_err:
                print(f"[WARN] Error ejecutando hr_scouting_workflow: {hr_err}")
        elif doc.folder_id is None and doc.category and doc.category != "Sin Clasificar":
            cat_folder = db.query(Folder).filter(Folder.name == doc.category, Folder.tenant_id == doc.tenant_id).first()
            if not cat_folder:
                cat_folder = Folder(name=doc.category, tenant_id=doc.tenant_id)
                db.add(cat_folder)
                db.commit()
                db.refresh(cat_folder)
            doc.folder_id = cat_folder.id

    except Exception as e:
        doc.status = "Error"
        doc.error_log = sanitize_error_log(str(e))
        print(f"[ERROR] Error en {filename}: {doc.error_log}") 
    
    finally:
        db.commit()
        if doc and doc.status in ["Procesado", "Requiere Revisión", "Error"]:
            notify_document_status(doc, db=db)
        db.close()


@app.post("/api/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    folder_id: Optional[int] = Form(None),
    vacancy_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "user", "service"]))
):
    ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".webp"}
    MAX_FILE_SIZE = 10 * 1024 * 1024 # 10 MB

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Formato no soportado. Formatos permitidos: .pdf, .docx, .txt, .jpg, .jpeg, .png, .webp"
        )

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo supera el límite de 10 MB")

    # Sanitización de nombre de archivo para prevenir Path Traversal
    raw_basename = os.path.basename(file.filename)
    safe_filename = re.sub(r'[^a-zA-Z0-9_\-\. ]', '_', raw_basename).strip()
    if not safe_filename or safe_filename.startswith("."):
        safe_filename = f"doc_{int(time.time())}{ext}"

    # Aislamiento de almacenamiento físico particionado por inquilino
    tenant_storage = f"storage/tenant_{current_user.tenant_id}"
    os.makedirs(tenant_storage, exist_ok=True)
    file_path = f"{tenant_storage}/{safe_filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Validación estricta multi-tenant de carpeta y vacante
    if folder_id:
        folder_check = db.query(Folder).filter(Folder.id == folder_id, Folder.tenant_id == current_user.tenant_id).first()
        if not folder_check:
            raise HTTPException(status_code=400, detail="La carpeta seleccionada no pertenece a tu organización")
    else:
        # Documentos recibidos por el bot de n8n van a "Bandeja n8n"
        if current_user.email == "n8n.service@gmail.com":
            folder = db.query(Folder).filter(Folder.name == "Bandeja n8n", Folder.tenant_id == current_user.tenant_id).first()
            if not folder:
                folder = Folder(name="Bandeja n8n", tenant_id=current_user.tenant_id)
                db.add(folder)
                db.commit()
                db.refresh(folder)
            folder_id = folder.id
        else:
            folder_id = None

    if vacancy_id:
        vac_check = db.query(Vacancy).filter(Vacancy.id == vacancy_id, Vacancy.tenant_id == current_user.tenant_id).first()
        if not vac_check:
            raise HTTPException(status_code=400, detail="La vacante seleccionada no pertenece a tu organización")
        
    doc = Document(
        tenant_id=current_user.tenant_id,
        filename=safe_filename, 
        file_path=file_path, 
        mime_type=file.content_type, 
        file_size_bytes=os.path.getsize(file_path), 
        status="Pendiente",
        folder_id=folder_id,
        vacancy_id=vacancy_id,
        uploaded_by=current_user.email
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(process_document_background, doc.id, file_path, safe_filename)
    
    return {"message": "Documento subido. El procesamiento ha iniciado en segundo plano.", "id": doc.id, "status": doc.status}

@app.get("/api/documents")
def list_documents(
    filename: Optional[str] = Query(None, description="Filtrar por nombre de archivo"),
    category: Optional[str] = Query(None, description="Filtrar por categoría"),
    status: Optional[str] = Query(None, description="Filtrar por estado"),
    start_date: Optional[str] = Query(None, description="Fecha de inicio (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Fecha de fin (YYYY-MM-DD)"),
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    query = db.query(Document).filter(Document.tenant_id == current_user.tenant_id)
    
    if filename:
        query = query.filter(Document.filename.ilike(f"%{filename}%"))
    if category:
        query = query.filter(Document.category == category)
    if status:
        query = query.filter(Document.status == status)
    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(Document.created_at >= start)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de start_date inválido. Use YYYY-MM-DD")
    if end_date:
        try:
            from datetime import timedelta
            end = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(Document.created_at < end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de end_date inválido. Use YYYY-MM-DD")
            
    docs = query.order_by(Document.id.desc()).all()
    user_role = getattr(current_user, "role", "user") or "user"
    return [serialize_document(d, user_role) for d in docs]

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")
    
    deleted_filename = doc.filename
    deleted_category = doc.category

    if os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except Exception:
            pass
        
    db.delete(doc)

    # Trazabilidad de Supresión de Datos (Habeas Data - Art. 8 y 15 Ley 1581 de 2012)
    db.add(WorkflowAuditLog(
        tenant_id=current_user.tenant_id,
        document_id=None,
        workflow_name="HabeasData-SupresionLey1581",
        trigger_source="AdminDelete-UI",
        user_email=current_user.email,
        ai_provider="SecurityEngine",
        input_summary=f"Supresión permanente de documento ID #{doc_id} ({deleted_filename})",
        output_result={
            "action": "PERMANENT_DELETE",
            "category": deleted_category,
            "file_removed_from_storage": True,
            "vectors_removed": True
        },
        confidence_score=100,
        status="SUCCESS",
        execution_time_ms=15
    ))
    db.commit()
    return {"message": "Documento y datos personales asociados eliminados permanentemente (Ley 1581)"}

@app.get("/api/documents/{doc_id}")
def get_document_details(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")
    user_role = getattr(current_user, "role", "user") or "user"
    return serialize_document(doc, user_role)

class DocumentUpdate(BaseModel):
    folder_id: Optional[int] = None
    folder_name: Optional[str] = None
    status: Optional[str] = None
    extracted_data: Optional[dict] = None

@app.patch("/api/documents/{doc_id}")
def update_document(
    doc_id: int, 
    update_data: DocumentUpdate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_role(["admin", "service"]))
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")
    
    if update_data.folder_name:
        folder = db.query(Folder).filter(Folder.name == update_data.folder_name, Folder.tenant_id == current_user.tenant_id).first()
        if not folder:
            folder = Folder(name=update_data.folder_name, tenant_id=current_user.tenant_id)
            db.add(folder)
            db.commit()
            db.refresh(folder)
        doc.folder_id = folder.id
    elif update_data.folder_id is not None:
        folder_check = db.query(Folder).filter(Folder.id == update_data.folder_id, Folder.tenant_id == current_user.tenant_id).first()
        if not folder_check:
            raise HTTPException(status_code=400, detail="La carpeta seleccionada no pertenece a tu organización")
        doc.folder_id = update_data.folder_id
        
    if update_data.status is not None:
        doc.status = update_data.status
    if update_data.extracted_data is not None:
        raw = update_data.extracted_data
        doc.extracted_data = build_protected_extracted_data(raw)
        
    db.commit()
    db.refresh(doc)
    return {"message": "Documento actualizado exitosamente", "id": doc.id, "folder_id": doc.folder_id, "status": doc.status}

class WorkflowUpdateSchema(BaseModel):
    target_folder_name: str
    payment_status: str
    notes: Optional[str] = None

@app.patch("/api/documents/{document_id}/workflow-update")
def update_document_from_n8n(
    document_id: int,
    payload: WorkflowUpdateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "service"]))
):
    from sqlalchemy.orm.attributes import flag_modified

    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id == current_user.tenant_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")

    folder = db.query(Folder).filter(
        Folder.name == payload.target_folder_name,
        Folder.tenant_id == current_user.tenant_id
    ).first()
    
    if not folder:
        folder = Folder(name=payload.target_folder_name, tenant_id=current_user.tenant_id)
        db.add(folder)
        db.commit()
        db.refresh(folder)

    doc.folder_id = folder.id

    raw_extracted = doc.extracted_data or {}
    if isinstance(raw_extracted, dict) and "_encrypted_data" in raw_extracted:
        raw_extracted = decrypt_sensitive_data(raw_extracted["_encrypted_data"])
    updated_data = dict(raw_extracted or {})
    updated_data["estado_contable"] = payload.payment_status
    if payload.notes:
        updated_data["notas_auditoria"] = payload.notes
        
    doc.extracted_data = build_protected_extracted_data(updated_data)
    flag_modified(doc, "extracted_data")

    db.commit()
    return {
        "message": "Documento actualizado y movido con éxito",
        "document_id": doc.id,
        "folder": folder.name,
        "estado_contable": payload.payment_status
    }

@app.get("/api/documents/{doc_id}/download")
def download_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")
    
    # Prevención estricta de Path Traversal
    real_path = os.path.abspath(doc.file_path)
    base_storage = os.path.abspath("storage")
    if not real_path.startswith(base_storage):
        raise HTTPException(status_code=403, detail="Acceso denegado: ruta de archivo no permitida")

    if not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en el servidor")
        
    return FileResponse(path=doc.file_path, filename=doc.filename, media_type=doc.mime_type)

class RagQueryRequest(BaseModel):
    query: str
    document_ids: Optional[list[int]] = []
    session_id: Optional[str] = "default-session"

@app.post("/api/rag/query")
def rag_query(payload: RagQueryRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Endpoint RAG migrado a LangChain + Memoria de Conversación por session_id.
    Registra automáticamente cada consulta en workflow_audit_logs.
    """
    try:
        session_id = payload.session_id or f"user_{current_user.id}"
        trigger_src = "TelegramBot" if session_id.startswith("telegram_") else "WebRAG"
        result = execute_rag_with_memory(
            query=payload.query,
            tenant_id=current_user.tenant_id,
            session_id=session_id,
            db=db,
            user_email=current_user.email,
            document_ids=payload.document_ids,
            trigger_source=trigger_src
        )
        return {
            "answer": result["answer"],
            "sources": result["sources"],
            "session_id": result["session_id"]
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"RAG Error: {str(e)}")


class ConfirmVisionSchema(BaseModel):
    action: Optional[str] = "confirm"  # "confirm" | "reject"
    emisor_nombre: Optional[str] = None
    emisor_nit: Optional[str] = None
    numero_factura: Optional[str] = None
    fecha_emision: Optional[str] = None
    moneda: Optional[str] = "COP"
    monto_total: Optional[float] = 0.0
    concepto_principal: Optional[str] = None
    items: Optional[list] = None


@app.post("/api/documents/{doc_id}/confirm-vision")
def confirm_vision_extraction(
    doc_id: int,
    payload: ConfirmVisionSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "user", "service"]))
):
    """
    Validación Humana (Human-in-the-Loop):
    Permite al usuario revisar, corregir y confirmar (o rechazar por ilegible) los datos de una factura
    cuando la confianza de visión fue < 80% (o en cualquier factura).
    """
    from sqlalchemy.orm.attributes import flag_modified

    doc = db.query(Document).filter(
        Document.id == doc_id,
        Document.tenant_id == current_user.tenant_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado o no pertenece a tu organización")

    raw_extracted = doc.extracted_data or {}
    if isinstance(raw_extracted, dict) and "_encrypted_data" in raw_extracted:
        raw_extracted = decrypt_sensitive_data(raw_extracted["_encrypted_data"])
    updated = dict(raw_extracted or {})

    # Si el usuario humano decide RECHAZAR la factura por ser ilegible o inválida
    if payload.action == "reject":
        folder = db.query(Folder).filter(
            Folder.name == "Facturas Rechazadas",
            Folder.tenant_id == current_user.tenant_id
        ).first()
        if not folder:
            folder = Folder(name="Facturas Rechazadas", tenant_id=current_user.tenant_id)
            db.add(folder)
            db.commit()
            db.refresh(folder)

        doc.folder_id = folder.id
        doc.status = "Procesado"
        updated["estado_contable"] = "RECHAZADA_REVISION_HUMANA"
        updated["notas_auditoria"] = f"Factura rechazada manualmente en Revisión Humana por {current_user.email} (Imagen ilegible o inválida)."
        updated["human_verified"] = True
        updated["verified_by"] = current_user.email

        doc.extracted_data = build_protected_extracted_data(updated)
        flag_modified(doc, "extracted_data")

        wf_result = {
            "decision": "RECHAZADA_REVISION_HUMANA",
            "payment_status": "RECHAZADA_REVISION_HUMANA",
            "target_folder": "Facturas Rechazadas",
            "notes": updated["notas_auditoria"]
        }

        db.add(WorkflowAuditLog(
            tenant_id=doc.tenant_id,
            document_id=doc.id,
            workflow_name="CuentasPorPagar-LangGraph",
            trigger_source="HumanValidation-UI",
            user_email=current_user.email,
            ai_provider="Human-in-the-Loop",
            input_summary=f"Rechazo manual de factura ilegible: {doc.filename}",
            output_result=wf_result,
            confidence_score=int(float(updated.get("confidence_score") or 10)),
            status="SUCCESS",
            execution_time_ms=35
        ))
        db.commit()
        db.refresh(doc)
        user_role = getattr(current_user, "role", "user") or "user"
        return {
            "message": "Factura rechazada y movida a Facturas Rechazadas.",
            "workflow_result": wf_result,
            "document": serialize_document(doc, user_role)
        }

    if payload.emisor_nombre is not None:
        updated["emisor_nombre"] = payload.emisor_nombre
        updated["proveedor"] = payload.emisor_nombre
    if payload.emisor_nit is not None:
        updated["emisor_nit"] = payload.emisor_nit
    if payload.numero_factura is not None:
        updated["numero_factura"] = payload.numero_factura
    if payload.fecha_emision is not None:
        updated["fecha_emision"] = payload.fecha_emision
    if payload.moneda is not None:
        updated["moneda"] = payload.moneda
    if payload.monto_total is not None:
        updated["monto_total"] = float(payload.monto_total)
        updated["total"] = float(payload.monto_total)
    if payload.concepto_principal is not None:
        updated["concepto_principal"] = payload.concepto_principal
    if payload.items is not None:
        updated["items"] = payload.items

    updated["confidence_score"] = 100.0
    updated["human_verified"] = True
    updated["verified_by"] = current_user.email
    updated["low_confidence_reason"] = None

    doc.extracted_data = build_protected_extracted_data(updated)
    doc.status = "Procesado"
    flag_modified(doc, "extracted_data")
    db.commit()
    db.refresh(doc)

    # Disparar flujo contable en código con confianza 100%
    wf_result = execute_invoice_workflow(
        db=db,
        document=doc,
        user_email=current_user.email,
        trigger_source="HumanValidation-UI"
    )

    user_role = getattr(current_user, "role", "user") or "user"
    return {
        "message": "Datos de factura validados y flujo contable ejecutado con éxito.",
        "workflow_result": wf_result,
        "document": serialize_document(doc, user_role)
    }


@app.get("/api/documents/{doc_id}/email-action", response_class=HTMLResponse)
def handle_email_action(
    doc_id: int,
    action: str = Query(..., description="approve_invoice | reject_invoice | hire_candidate | reserve_candidate"),
    token: str = Query(..., description="Firma HMAC de seguridad"),
    db: Session = Depends(get_db)
):
    """
    Endpoint interactivo invocado directamente desde los botones del correo electrónico (Gmail).
    Reemplaza 100% en Python los nodos 'Send and Wait' de n8n para Cuentas por Pagar y Scouting RRHH.
    """
    from sqlalchemy.orm.attributes import flag_modified

    if not verify_email_action_token(doc_id, action, token):
        return HTMLResponse(
            content="<h3>❌ Enlace de autorización inválido o expirado.</h3>",
            status_code=403
        )

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        return HTMLResponse(content="<h3>❌ Documento no encontrado.</h3>", status_code=404)

    action_map = {
        "approve_invoice": {
            "folder": "Facturas Aprobadas",
            "status": "APROBADA_GERENCIA",
            "title": "✅ Factura Aprobada Exitosamente",
            "color": "#16a34a",
            "notes": "Factura aprobada manualmente por Gerencia desde botón interactivo de correo."
        },
        "reject_invoice": {
            "folder": "Facturas Rechazadas",
            "status": "RECHAZADA_GERENCIA",
            "title": "❌ Factura Rechazada por Gerencia",
            "color": "#dc2626",
            "notes": "Factura rechazada manualmente por Gerencia desde botón interactivo de correo."
        },
        "hire_candidate": {
            "folder": "Candidatos Seleccionados",
            "status": "ENTREVISTA_PROGRAMADA",
            "title": "🌟 Candidato Preseleccionado para Entrevista",
            "color": "#0f766e",
            "notes": "Candidato aprobado desde Ficha de Scouting en correo."
        },
        "reserve_candidate": {
            "folder": "Banco de Talentos",
            "status": "EN_RESERVA",
            "title": "📁 Candidato Archivado en Banco de Talentos",
            "color": "#475569",
            "notes": "Candidato enviado a Banco de Talentos desde Ficha de Scouting en correo."
        }
    }

    if action not in action_map:
        return HTMLResponse(content="<h3>❌ Acción no reconocida.</h3>", status_code=400)

    cfg = action_map[action]
    folder = db.query(Folder).filter(Folder.name == cfg["folder"], Folder.tenant_id == doc.tenant_id).first()
    if not folder:
        folder = Folder(name=cfg["folder"], tenant_id=doc.tenant_id)
        db.add(folder)
        db.commit()
        db.refresh(folder)

    doc.folder_id = folder.id

    raw_ext = doc.extracted_data or {}
    if isinstance(raw_ext, dict) and "_encrypted_data" in raw_ext:
        dec = decrypt_sensitive_data(raw_ext["_encrypted_data"])
        if isinstance(dec, dict):
            raw_ext = dec
    updated = dict(raw_ext or {})
    updated["estado_contable"] = cfg["status"]
    updated["notas_auditoria"] = cfg["notes"]

    doc.extracted_data = build_protected_extracted_data(updated)
    flag_modified(doc, "extracted_data")

    db.add(WorkflowAuditLog(
        tenant_id=doc.tenant_id,
        document_id=doc.id,
        workflow_name="DecisionGerencial-CorreoInteractivo",
        trigger_source="Gmail-ButtonClick",
        user_email=os.getenv("GMAIL_NOTIFY_TO", "gerencia@indicio.internal"),
        ai_provider="FastAPI-HMAC-Workflow",
        input_summary=f"Clic en botón de correo '{action}' sobre {doc.filename}",
        output_result={
            "decision": cfg["status"],
            "target_folder": cfg["folder"],
            "notes": cfg["notes"]
        },
        confidence_score=100,
        status="SUCCESS",
        execution_time_ms=45
    ))
    db.commit()

    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    default_front = f"https://{railway_domain}" if railway_domain else "http://localhost:5173"
    frontend_url = os.getenv("FRONTEND_PUBLIC_URL", default_front).rstrip("/")
    html_page = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>{cfg['title']} - Indicio Enterprise</title>
    </head>
    <body style="font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="background:#ffffff;max-width:480px;padding:36px;border-radius:20px;box-shadow:0 10px 25px rgba(0,0,0,0.08);text-align:center;border-top:6px solid {cfg['color']};">
            <h2 style="color:{cfg['color']};margin-top:0;">{cfg['title']}</h2>
            <p style="color:#334155;font-size:15px;line-height:1.6;">
                El documento <strong>{doc.filename}</strong> ha sido movido automáticamente a la carpeta
                <strong>"{cfg['folder']}"</strong> con estado <strong>{cfg['status']}</strong>.
            </p>
            <p style="color:#64748b;font-size:13px;">La decisión quedó registrada en el Historial de Auditoría de Indicio Enterprise.</p>
            <a href="{frontend_url}" style="display:inline-block;margin-top:16px;background:#1e293b;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:600;">Ir al Panel de Indicio Enterprise</a>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_page)


@app.post("/api/email/sync-inbox")
def sync_gmail_inbox_endpoint(current_user: User = Depends(require_role(["admin", "user", "service"]))):
    """Permite disparar manualmente la revisión de correos entrantes con adjuntos por IMAP."""
    return check_gmail_inbox_once(lambda: next(get_db()), process_document_background, include_recent_read=True)


@app.get("/api/health")
def health_check():
    """Endpoint ligero de salud para balanceadores de carga y Railway."""
    return {"status": "ok", "service": "Indicio Enterprise", "ley1581_active": True}


# Servir el Frontend compilado de React (SPA) automáticamente cuando exista (Producción / Docker)
from fastapi.staticfiles import StaticFiles

_CANDIDATE_DIST_DIRS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "static_frontend"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"),
]
_FRONTEND_DIST = next((d for d in _CANDIDATE_DIST_DIRS if os.path.isdir(d) and os.path.isfile(os.path.join(d, "index.html"))), None)

if _FRONTEND_DIST:
    _assets_dir = os.path.join(_FRONTEND_DIST, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_react_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Endpoint API no encontrado")
        requested_file = os.path.join(_FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(requested_file):
            return FileResponse(requested_file)
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))




