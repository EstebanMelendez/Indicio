import os
import shutil
import json
import time
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Form, Query, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db, engine, Base
from app.models import Document, DocumentChunk, Folder, User, BlacklistedToken
from app.auth import get_current_user, create_access_token, verify_password, oauth2_scheme
from app.notifications import notify_document_status
import google.generativeai as genai
import pdfplumber
import docx
from dotenv import load_dotenv

load_dotenv()

# Configuración IA
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_TEXT = os.getenv("GEMINI_TEXT_MODEL", "gemini-2.0-flash")
MODEL_EMB = os.getenv("GEMINI_EMBEDDING_MODEL", "models/text-embedding-005")

app = FastAPI(title="Indicio Enterprise")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

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
    errors = db.query(Document).filter(Document.tenant_id == current_user.tenant_id, Document.status == "Error").count()
    
    categories_query = db.query(Document.category, func.count(Document.id)).filter(Document.tenant_id == current_user.tenant_id).group_by(Document.category).all()
    categories = {cat if cat else "Sin Clasificar": count for cat, count in categories_query}
    
    return {
        "total": total, 
        "processed": processed, 
        "errors": errors,
        "categories": categories
    }

class FolderCreate(BaseModel):
    name: str

@app.post("/api/folders")
def create_folder(folder: FolderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_folder = Folder(name=folder.name, tenant_id=current_user.tenant_id)
    db.add(new_folder)
    db.commit()
    db.refresh(new_folder)
    return new_folder

@app.get("/api/folders")
def list_folders(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Folder).filter(Folder.tenant_id == current_user.tenant_id).order_by(Folder.created_at.desc()).all()

@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.tenant_id == current_user.tenant_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    db.delete(folder)
    db.commit()
    return {"message": "Carpeta eliminada"}

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
        
        # 1. Extracción con validación
        raw_text = extract_text(file_path, filename)
        if not raw_text or len(raw_text.strip()) < 10:
            raise ValueError("El documento está vacío o no se pudo extraer texto legible.")
        
        # 2. Clasificación con manejo de errores JSON
        model = genai.GenerativeModel(MODEL_TEXT)
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
                // "monto_subtotal": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 1200000.00),
                // "monto_impuestos": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 228000.00),
                // "monto_total": number (numérico limpio float/int, sin símbolos $ ni puntos de miles, ej: 1428000.00),
                // "concepto_principal": string (descripción breve del servicio o bien)

                // Si es "Recibos y Comprobantes de Pago":
                // "emisor_nombre": string,
                // "receptor_nombre": string,
                // "numero_recibo": string (o null),
                // "fecha_pago": string,
                // "moneda": string,
                // "monto_total": number (numérico limpio float/int, sin símbolos ni puntos de miles),
                // "concepto_principal": string,
                // "metodo_pago": string (ej: "Transferencia", "Efectivo", o null)

                // Si es "Contratos y Acuerdos Legales": "partes", "objeto", "vigencia", "valor".
                // Si es "Hojas de Vida / Perfiles Laborales": "postulante", "rol", "anos_experiencia", "competencias", "formacion".
                // Si es "Reportes y Estados Financieros": "empresa", "periodo", "tipo_reporte", "ingresos", "gastos".
                // Si es "Actas de Reunión": "fecha", "asistentes", "temas_tratados", "conclusiones".
                // Si es "Manuales y Procedimientos": "titulo", "departamento", "proposito", "version".
            }}
        }}

        REGLA ESTRICTA PARA MONTOS: Los campos 'monto_total', 'monto_subtotal' y 'monto_impuestos' deben ser EXCLUSIVAMENTE de tipo number (flotante o entero), NUNCA cadenas de texto, sin símbolos como '$', sin 'COP'/'USD' y sin separadores de miles con puntos. Ejemplo correcto: 1428000.00. Ejemplo incorrecto: "$ 1.428.000".

        Documento: {raw_text[:8000]}"""
        
        response = None
        for attempt in range(3):
            try:
                response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                break
            except Exception as e:
                if "429" in str(e) or "Quota exceeded" in str(e):
                    if attempt < 2:
                        print(f"⚠️ Cuota excedida (Rate Limit). Esperando 20 segundos antes de reintentar (Intento {attempt+1}/3)...")
                        time.sleep(20)
                        continue
                raise e
        
        if not response:
            raise ValueError("No se pudo obtener respuesta de la IA.")
            
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
        
        # Sanitización defensiva de montos numéricos para garantizar compatibilidad total con n8n
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
        doc.extracted_data = extracted

        # 3. Vectorización
        chunks = [raw_text[i:i+700] for i in range(0, len(raw_text), 700)]
        for i, chunk in enumerate(chunks):
            emb = None
            for attempt in range(3):
                try:
                    emb = genai.embed_content(model=MODEL_EMB, content=chunk, task_type="retrieval_document", output_dimensionality=768)['embedding']
                    break
                except Exception as e:
                    if "429" in str(e) or "Quota exceeded" in str(e):
                        if attempt < 2:
                            print(f"⚠️ Cuota excedida (Rate Limit) en embeddings. Esperando 20 segundos... (Intento {attempt+1}/3)")
                            time.sleep(20)
                            continue
                    raise e
            
            if emb:
                db.add(DocumentChunk(document_id=doc.id, chunk_index=i, chunk_text=chunk, embedding=emb))

        doc.status = "Procesado"
        print(f"✅ Éxito procesando: {filename}")

    except Exception as e:
        doc.status = "Error"
        doc.error_log = str(e)
        print(f"❌ Error en {filename}: {str(e)}") 
    
    finally:
        db.commit()
        if doc and doc.status in ["Procesado", "Error"]:
            notify_document_status(doc)
        db.close()


@app.post("/api/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    folder_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
    MAX_FILE_SIZE = 10 * 1024 * 1024 # 10 MB

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Formato de archivo no soportado. Solo .pdf, .docx y .txt permitidos.")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo supera el límite de 10 MB")

    os.makedirs(f"storage/tenant_{current_user.tenant_id}", exist_ok=True)
    file_path = f"storage/tenant_{current_user.tenant_id}/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    if not folder_id:
        from app.models import Folder
        folder = db.query(Folder).filter(Folder.name == "Bandeja n8n", Folder.tenant_id == current_user.tenant_id).first()
        if not folder:
            folder = Folder(name="Bandeja n8n", tenant_id=current_user.tenant_id)
            db.add(folder)
            db.commit()
            db.refresh(folder)
        folder_id = folder.id
        
    doc = Document(
        tenant_id=current_user.tenant_id,
        filename=file.filename, 
        file_path=file_path, 
        mime_type=file.content_type, 
        file_size_bytes=os.path.getsize(file_path), 
        status="Pendiente",
        folder_id=folder_id
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(process_document_background, doc.id, file_path, file.filename)
    
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
            # We add 1 day to end_date to include the whole day (up to 23:59:59)
            from datetime import timedelta
            end = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(Document.created_at < end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de end_date inválido. Use YYYY-MM-DD")
            
    return query.order_by(Document.id.desc()).all()

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
        
    db.delete(doc)
    db.commit()
    return {"message": "Documento eliminado"}

@app.get("/api/documents/{doc_id}")
def get_document_details(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return doc

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
    current_user: User = Depends(get_current_user)
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.tenant_id == current_user.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    
    if update_data.folder_name:
        folder = db.query(Folder).filter(Folder.name == update_data.folder_name, Folder.tenant_id == current_user.tenant_id).first()
        if not folder:
            folder = Folder(name=update_data.folder_name, tenant_id=current_user.tenant_id)
            db.add(folder)
            db.commit()
            db.refresh(folder)
        doc.folder_id = folder.id
    elif update_data.folder_id is not None:
        doc.folder_id = update_data.folder_id
        
    if update_data.status is not None:
        doc.status = update_data.status
    if update_data.extracted_data is not None:
        doc.extracted_data = update_data.extracted_data
        
    db.commit()
    db.refresh(doc)
    return {"message": "Documento actualizado exitosamente", "id": doc.id, "folder_id": doc.folder_id, "status": doc.status}

class WorkflowUpdateSchema(BaseModel):
    target_folder_name: str
    payment_status: str  # Ej: "APROBADA", "RECHAZADA", "DUPLICADA", "PENDIENTE_APROBACION"
    notes: Optional[str] = None

@app.patch("/api/documents/{document_id}/workflow-update")
def update_document_from_n8n(
    document_id: int,
    payload: WorkflowUpdateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from sqlalchemy.orm.attributes import flag_modified

    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id == current_user.tenant_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # 1. Buscar o crear la carpeta destino automáticamente para ese tenant
    folder = db.query(Folder).filter(
        Folder.name == payload.target_folder_name,
        Folder.tenant_id == current_user.tenant_id
    ).first()
    
    if not folder:
        folder = Folder(name=payload.target_folder_name, tenant_id=current_user.tenant_id)
        db.add(folder)
        db.commit()
        db.refresh(folder)

    # 2. Mover documento de carpeta
    doc.folder_id = folder.id

    # 3. Guardar trazabilidad contable dentro de extracted_data
    updated_data = dict(doc.extracted_data or {})
    updated_data["estado_contable"] = payload.payment_status
    if payload.notes:
        updated_data["notas_auditoria"] = payload.notes
    doc.extracted_data = updated_data
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
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    
    if not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en el servidor")
        
    return FileResponse(path=doc.file_path, filename=doc.filename, media_type=doc.mime_type)

class RagQueryRequest(BaseModel):
    query: str
    document_ids: Optional[list[int]] = []

@app.post("/api/rag/query")
def rag_query(payload: RagQueryRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = payload.query
    q_emb = genai.embed_content(model=MODEL_EMB, content=query, task_type="retrieval_query", output_dimensionality=768)['embedding']
    
    dist_expr = DocumentChunk.embedding.cosine_distance(q_emb)
    # Threshold de distancia opcional para evitar ruido: dist_expr < 0.3
    
    base_query = db.query(DocumentChunk.chunk_text, Document.filename, dist_expr.label("dist")) \
                .join(Document).filter(Document.tenant_id == current_user.tenant_id, dist_expr < 0.4)
                
    if payload.document_ids:
        base_query = base_query.filter(Document.id.in_(payload.document_ids))
        
    results = base_query.order_by(dist_expr).limit(3).all()
                
    if not results:
        return {"answer": "No encontré información relevante en los documentos para responder a tu pregunta.", "sources": []}
        
    context = "\n".join([f"Archivo {r[1]}: {r[0]}" for r in results])
    
    model = genai.GenerativeModel(MODEL_TEXT)
    prompt = f"Responde la pregunta basándote SOLO en este contexto. Cita los archivos. Contexto:\n{context}\nPregunta: {query}"
    return {"answer": model.generate_content(prompt).text, "sources": list(set([r[1] for r in results]))}
