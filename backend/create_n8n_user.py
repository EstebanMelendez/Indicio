import os
from sqlalchemy import create_engine
from dotenv import load_dotenv
from app.models import Base, User, Tenant
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
    print("[SEGURIDAD] Configurando cuenta de servicio n8n con rol 'service'...")
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        if not tenant:
            tenant = Tenant(id=1, name="Organización Principal")
            db.add(tenant)
            db.commit()

        email = "n8n.service@gmail.com"
        user = db.query(User).filter(User.email == email).first()
        hashed = pwd_context.hash(N8N_PASSWORD)
        if not user:
            new_user = User(
                email=email,
                hashed_password=hashed,
                role="service",
                tenant_id=tenant.id
            )
            db.add(new_user)
            db.commit()
            print(f"[OK] Usuario de servicio '{email}' creado con rol 'service' y tenant_id={tenant.id}.")
        else:
            user.hashed_password = hashed
            user.role = "service"
            if user.tenant_id is None:
                user.tenant_id = tenant.id
            db.commit()
            print(f"[OK] Usuario de servicio '{email}' actualizado con rol 'service'.")
    finally:
        db.close()

if __name__ == "__main__":
    run()
