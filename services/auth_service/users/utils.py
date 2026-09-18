import jwt
import datetime
import uuid
from django.conf import settings

JWT_SECRET = getattr(settings, 'SECRET_KEY', 'default-secret-key-for-dev')
JWT_ALGORITHM = 'HS256'
# Short-lived access token — kept small on purpose now that a refresh token
# exists to silently renew it, instead of the old single 24h token that just
# hard-logged everyone out once it expired.
JWT_ACCESS_EXPIRATION_MINUTES = 120
# Long-lived refresh token — lets a viewer's session survive well past a
# single access token's lifetime without re-entering the event passcode,
# as long as their session hasn't been evicted (logged in elsewhere) or
# their account disabled in the meantime (both still checked on refresh).
JWT_REFRESH_EXPIRATION_DAYS = 30

def _build_payload(user_id: str, email: str, is_admin: bool, is_super_admin: bool, session_id: str, token_type: str, expires_at: datetime.datetime) -> dict:
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        'user_id': str(user_id),
        'email': email,
        'is_admin': is_admin,
        'is_super_admin': is_super_admin,
        'session_id': session_id,
        'type': token_type,
        'iat': now,
        'exp': expires_at,
    }

def generate_jwt_token(user_id: str, email: str, is_admin: bool, is_super_admin: bool = False, session_id: str = None) -> tuple[str, str, str]:
    """
    Generates a short-lived ACCESS token and a long-lived REFRESH token for
    the same session. Returns (access_token, refresh_token, session_id).
    """
    if not session_id:
        session_id = str(uuid.uuid4())

    now = datetime.datetime.now(datetime.timezone.utc)
    access_payload = _build_payload(user_id, email, is_admin, is_super_admin, session_id, 'access', now + datetime.timedelta(minutes=JWT_ACCESS_EXPIRATION_MINUTES))
    refresh_payload = _build_payload(user_id, email, is_admin, is_super_admin, session_id, 'refresh', now + datetime.timedelta(days=JWT_REFRESH_EXPIRATION_DAYS))

    access_token = jwt.encode(access_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    refresh_token = jwt.encode(refresh_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return access_token, refresh_token, session_id

def decode_jwt_token(token: str) -> dict:
    """
    Decodes and validates a JWT token string (either an access or refresh
    token — callers that care which are expected to check payload['type']).
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid authentication token.")
