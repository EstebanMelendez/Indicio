from app.database import engine, Base
from app.models import Tenant, User, BlacklistedToken, Folder, Vacancy, Document, DocumentChunk
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';"))
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
    conn.commit()

Base.metadata.create_all(bind=engine)
print("[OK] Todas las tablas y extensiones verificadas y creadas exitosamente.")
