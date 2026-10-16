import json
import time
import os
import urllib.request
import urllib.error

base_url = "http://127.0.0.1:8000/api"

print("[1] Logging in as admin...")
login_data = json.dumps({"email": "indicio.admin@gmail.com", "password": "admin123"}).encode("utf-8")
req = urllib.request.Request(f"{base_url}/auth/login", data=login_data, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as resp:
    token = json.loads(resp.read())["access_token"]

headers = {"Authorization": f"Bearer {token}"}

pdf_path = "Documentos_Prueba/hojavida_01.pdf"
filename = os.path.basename(pdf_path)
with open(pdf_path, "rb") as f:
    pdf_bytes = f.read()

print(f"[2] Uploading {filename} ({len(pdf_bytes)} bytes)...")
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body_parts = [
    f"--{boundary}".encode("utf-8"),
    f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode("utf-8"),
    b"Content-Type: application/pdf",
    b"",
    pdf_bytes,
    f"--{boundary}--".encode("utf-8"),
    b""
]
body = b"\r\n".join(body_parts)

req = urllib.request.Request(f"{base_url}/documents/upload", data=body, headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": f"multipart/form-data; boundary={boundary}"
})

with urllib.request.urlopen(req) as resp:
    doc_id = json.loads(resp.read())["id"]

print(f"[3] Uploaded successfully! Document ID: {doc_id}")
print("[4] Waiting for Gemini AI processing and n8n webhook...")

for _ in range(20):
    time.sleep(2)
    req = urllib.request.Request(f"{base_url}/documents/{doc_id}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    status = data.get("status")
    print(f" -> Status: {status}")
    if status in ["Procesado", "Error"]:
        print("[5] Final document details:")
        print(f"  Category: {data.get('category')}")
        print(f"  Folder ID: {data.get('folder_id')}")
        print(f"  Summary: {data.get('summary')}")
        print(f"  Extracted Data: {json.dumps(data.get('extracted_data'), indent=2, ensure_ascii=False)}")
        break
