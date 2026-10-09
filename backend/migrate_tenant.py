import os
from sqlalchemy import text
from app.database import engine
from app.models import Base

def migrate():
    with engine.connect() as conn:
        print("Creating tenants table if not exists...")
        Base.metadata.create_all(bind=engine)
        
        print("Creating default tenant...")
        result = conn.execute(text("INSERT INTO tenants (name) VALUES ('Default Enterprise') ON CONFLICT DO NOTHING RETURNING id;"))
        tenant_id = result.scalar()
        if not tenant_id:
            # Si ya existía, lo buscamos
            tenant_id = conn.execute(text("SELECT id FROM tenants LIMIT 1;")).scalar()
        
        conn.commit()
        
        print(f"Default tenant ID: {tenant_id}")
        print("Updating users, folders, documents with tenant_id...")
        
        # Add columns if they don't exist (using raw SQL for sqlite/postgres depending on DB)
        # Assuming PostgreSQL based on pgvector
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE folders ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;"))
        except Exception as e:
            print(f"Column might already exist: {e}")
            
        conn.execute(text(f"UPDATE users SET tenant_id = {tenant_id} WHERE tenant_id IS NULL;"))
        conn.execute(text(f"UPDATE folders SET tenant_id = {tenant_id} WHERE tenant_id IS NULL;"))
        conn.execute(text(f"UPDATE documents SET tenant_id = {tenant_id} WHERE tenant_id IS NULL;"))
        conn.commit()
        print("Migration complete!")

if __name__ == "__main__":
    migrate()
