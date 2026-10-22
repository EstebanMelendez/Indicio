import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from app.models import Base, User, Tenant
from passlib.context import CryptContext
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL no configurada")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def run():
    print("[SEGURIDAD] Inicializando extensiones y tablas...")
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        # Si la tabla users ya existe, asegurar la columna role
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Asegurar existencia de Tenant por defecto
        tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        if not tenant:
            tenant = Tenant(id=1, name="Organización Principal")
            db.add(tenant)
            db.commit()
            print("[SEGURIDAD] Tenant por defecto (ID 1: Organización Principal) creado.")

        admin_pwd = os.getenv("ADMIN_PASSWORD", "admin123")
        auditor_pwd = os.getenv("AUDITOR_PASSWORD", "auditor123")

        users_data = [
            {"email": "indicio.admin@gmail.com", "password": admin_pwd, "role": "admin", "name": "Administrador"},
            {"email": "indicio.auditor@gmail.com", "password": auditor_pwd, "role": "auditor", "name": "Auditor"}
        ]
        
        for u_data in users_data:
            user = db.query(User).filter(User.email == u_data["email"]).first()
            hashed = pwd_context.hash(u_data["password"])
            if not user:
                print(f"[SEGURIDAD] Creando {u_data['name']} ({u_data['email']}) con rol '{u_data['role']}'...")
                new_user = User(
                    email=u_data["email"],
                    hashed_password=hashed,
                    role=u_data["role"],
                    tenant_id=tenant.id
                )
                db.add(new_user)
                db.commit()
                print(f"[OK] Usuario '{u_data['email']}' registrado.")
            else:
                print(f"[SEGURIDAD] Actualizando credenciales y rol para {u_data['email']}...")
                user.hashed_password = hashed
                user.role = u_data["role"]
                if user.tenant_id is None:
                    user.tenant_id = tenant.id
                db.commit()
                print(f"[OK] Usuario '{u_data['email']}' actualizado con rol '{u_data['role']}'.")
    finally:
        db.close()

if __name__ == "__main__":
    run()
