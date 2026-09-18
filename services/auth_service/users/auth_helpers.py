from functools import wraps
from rest_framework.response import Response
from rest_framework import status
from .utils import decode_jwt_token
from services.common.redis_client import SessionManager

def get_token_from_request(request):
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header.split(' ')[1]
    return None

def enforce_active_session(view_func):
    """
    Decorator for DRF view functions that verifies JWT token signature AND
    asserts that the session_id matches the active session in Redis/cache.
    If session was evicted by a newer login on another device, returns HTTP 401.
    """
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        token = get_token_from_request(request)
        if not token:
            return Response({
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Authentication credentials were not provided.",
                    "details": {}
                }
            }, status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = decode_jwt_token(token)
            # A refresh token is only ever valid at POST /auth/refresh/ — reject
            # it here so a leaked/long-lived refresh token can't be used
            # directly against protected endpoints in place of an access token.
            if payload.get('type') != 'access':
                raise ValueError("This is not a valid access token. Please log in again.")
            user_id = payload.get('user_id')
            session_id = payload.get('session_id')

            session_check = SessionManager.check_session_status(user_id, session_id)
            if session_check == 'not_found':
                # Session not found — server may have restarted or session expired naturally.
                # Re-register the session so the user stays logged in seamlessly.
                email = payload.get('email', '')
                SessionManager.set_active_session(str(user_id), email, session_id)
            elif session_check == 'evicted':
                # A different session_id is active — user logged in from another device.
                return Response({
                    "success": False,
                    "error": {
                        "code": "SESSION_EVICTED",
                        "message": "Your session has been revoked because your account was logged in from another device.",
                        "details": {}
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)

            request.user_claims = payload
            return view_func(request, *args, **kwargs)
        except ValueError as e:
            return Response({
                "success": False,
                "error": {
                    "code": "INVALID_TOKEN",
                    "message": str(e),
                    "details": {}
                }
            }, status=status.HTTP_401_UNAUTHORIZED)

    return _wrapped_view

def require_admin(view_func):
    """
    Decorator requiring the request to have admin or super admin claims.
    """
    @enforce_active_session
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        claims = getattr(request, 'user_claims', {})
        if not (claims.get('is_admin') or claims.get('is_super_admin')):
            return Response({
                "success": False,
                "error": {
                    "code": "PERMISSION_DENIED",
                    "message": "Administrator privileges are required for this resource.",
                    "details": {}
                }
            }, status=status.HTTP_403_FORBIDDEN)
        return view_func(request, *args, **kwargs)
    return _wrapped_view

def require_super_admin(view_func):
    """
    Decorator requiring the request to have Super Administrator (events@chennaimath.org) claims.
    """
    @enforce_active_session
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        claims = getattr(request, 'user_claims', {})
        if not claims.get('is_super_admin'):
            return Response({
                "success": False,
                "error": {
                    "code": "PERMISSION_DENIED",
                    "message": "Super Administrator privileges (events@chennaimath.org) are required for this operation.",
                    "details": {}
                }
            }, status=status.HTTP_403_FORBIDDEN)
        return view_func(request, *args, **kwargs)
    return _wrapped_view
