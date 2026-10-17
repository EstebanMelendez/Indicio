import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from app.models import Base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL no configurada en .env")

engine = create_engine(DATABASE_URL)

def migrate():
    print("Verificando extensión de pgvector...")
    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()
            print("Extensión vector asegurada.")
        except Exception as e:
            print(f"Nota vector: {e}")

    print("Creando tabla vacancies...")
    Base.metadata.create_all(bind=engine)
    
    print("Añadiendo columna vacancy_id a documents (si no existe)...")
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS vacancy_id INTEGER REFERENCES vacancies(id) ON DELETE SET NULL;"))
            conn.commit()
            print("Columna vacancy_id verificada / añadida con éxito.")
        except Exception as e:
            print(f"Nota al añadir columna: {e}")
            
    print("¡Migración de Vacantes completada!")

if __name__ == "__main__":
    migrate()
