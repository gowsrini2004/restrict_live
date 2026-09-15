import jwt
import datetime
import uuid
from django.conf import settings

JWT_SECRET = getattr(settings, 'SECRET_KEY', 'default-secret-key-for-dev')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

def generate_jwt_token(user_id: str, email: str, is_admin: bool, is_super_admin: bool = False, session_id: str = None) -> tuple[str, str]:
    """
    Generates a JWT token containing user attributes, admin claims, and a unique session_id.
    Returns (token_str, session_id).
    """
    if not session_id:
        session_id = str(uuid.uuid4())

    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        'user_id': str(user_id),
        'email': email,
        'is_admin': is_admin,
        'is_super_admin': is_super_admin,
        'session_id': session_id,
        'iat': now,
        'exp': now + datetime.timedelta(hours=JWT_EXPIRATION_HOURS)
    }

    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, session_id

def decode_jwt_token(token: str) -> dict:
    """
    Decodes and validates a JWT token string.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid authentication token.")
