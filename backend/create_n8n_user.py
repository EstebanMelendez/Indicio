import os
from sqlalchemy import create_engine
from dotenv import load_dotenv
from app.models import Base, User
from passlib.context import CryptContext
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL no configurada")

N8N_PASSWORD = os.getenv("N8N_SERVICE_PASSWORD")
if not N8N_PASSWORD:
    raise ValueError("N8N_SERVICE_PASSWORD no configurada en el entorno")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def run():
    print("Creando usuario de servicio n8n...")
    db = SessionLocal()
    try:
        email = "n8n.service@gmail.com"
        user = db.query(User).filter(User.email == email).first()
        hashed = pwd_context.hash(N8N_PASSWORD)
        if not user:
            new_user = User(email=email, hashed_password=hashed)
            db.add(new_user)
            db.commit()
            print(f"Usuario de servicio '{email}' creado exitosamente.")
        else:
            user.hashed_password = hashed
            db.commit()
            print(f"Contraseña actualizada para el usuario de servicio '{email}'.")
    finally:
        db.close()

if __name__ == "__main__":
    run()
