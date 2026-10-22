import os
import logging
from datetime import datetime, timedelta
from typing import Optional, List
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, BlacklistedToken
from app.crypto import get_symmetric_cipher
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("IndicioAuth")

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    logger.warning("[SEGURIDAD CRÍTICA] JWT_SECRET_KEY no configurado en .env. Se usará una derivación criptográfica segura en memoria.")
    # Derivar una clave segura a partir del cifrador local
    SECRET_KEY = get_symmetric_cipher()._signing_key.hex()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 4

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales de acceso",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    is_blacklisted = db.query(BlacklistedToken).filter(BlacklistedToken.token == token).first()
    if is_blacklisted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o cerrada previamente",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
        
    # Refuerzo de seguridad multi-tenant: garantizar que siempre tenga un tenant_id válido
    if user.tenant_id is None:
        user.tenant_id = 1
        db.commit()
        db.refresh(user)

    return user

def require_role(allowed_roles: List[str]):
    """
    Control de Acceso Basado en Roles (RBAC).
    Restringe la ejecución de un endpoint a usuarios con roles específicos.
    Ejemplo: Depends(require_role(["admin"])) o Depends(require_role(["admin", "auditor"]))
    """
    def role_dependency(current_user: User = Depends(get_current_user)) -> User:
        user_role = getattr(current_user, "role", "user") or "user"
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso restringido: Esta acción requiere privilegios de {', '.join(allowed_roles)}. Tu rol actual es '{user_role}'."
            )
        return current_user
    return role_dependency

