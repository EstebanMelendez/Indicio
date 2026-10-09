import os
import shutil
from sqlalchemy import text
from app.database import engine

def migrate_files():
    with engine.connect() as conn:
        print("Fetching existing documents...")
        result = conn.execute(text("SELECT id, file_path, tenant_id FROM documents;"))
        documents = result.fetchall()
        
        for doc_id, old_path, tenant_id in documents:
            if not tenant_id:
                tenant_id = 1
                
            new_dir = f"storage/tenant_{tenant_id}"
            os.makedirs(new_dir, exist_ok=True)
            
            # If it's already in the new format, skip
            if old_path.startswith(f"storage/tenant_{tenant_id}/") or old_path.startswith(f"storage\\tenant_{tenant_id}\\"):
                continue
                
            filename = os.path.basename(old_path)
            new_path = f"{new_dir}/{filename}"
            
            print(f"Moving doc {doc_id} from {old_path} to {new_path}")
            
            # Move physical file
            if os.path.exists(old_path):
                shutil.move(old_path, new_path)
            else:
                print(f"  Warning: File {old_path} not found on disk.")
                
            # Update database
            conn.execute(text(f"UPDATE documents SET file_path = '{new_path}' WHERE id = {doc_id};"))
            
        conn.commit()
        print("File migration complete!")

if __name__ == "__main__":
    migrate_files()
