from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone

from .models import AuthorizedUser, SystemConfig
from .serializers import (
    LoginSerializer,
    BulkUserImportSerializer,
    AuthorizedUserSerializer,
    CreateUserSerializer,
    SystemConfigSerializer
)
from .utils import generate_jwt_token, decode_jwt_token
from .auth_helpers import enforce_active_session, require_admin, require_super_admin
from services.common.redis_client import SessionManager

SUPER_ADMIN_EMAIL = "events@chennaimath.org"
DEFAULT_PASSCODE = "IRK2026"
DEFAULT_ADMIN_PASSCODE = "183663"
# Distinct from the Admin Common Passcode above — only events@chennaimath.org
# (the one hardcoded Super Admin account) logs in with this one, so it isn't
# the same shared credential every ordinary Administrator also knows.
DEFAULT_SUPER_ADMIN_PASSCODE = "Mother108*"

def get_system_passcode(key='COMMON_PASSCODE', default=DEFAULT_PASSCODE):
    config = SystemConfig.objects.filter(key=key).first()
    return config.value if config else default

@api_view(['POST'])
def login_view(request):
    """
    Authenticate user by Email and Event Passcode.
    Supports Super Admin (events@chennaimath.org), Admins, and Attendees.
    Single-device enforcement: Invalidates any existing active session for this user.
    """
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data['email']
    passcode = serializer.validated_data['passcode']

    attendee_passcode = get_system_passcode('COMMON_PASSCODE', DEFAULT_PASSCODE)
    admin_passcode = get_system_passcode('ADMIN_PASSCODE', DEFAULT_ADMIN_PASSCODE)
    super_admin_passcode = get_system_passcode('SUPER_ADMIN_PASSCODE', DEFAULT_SUPER_ADMIN_PASSCODE)

    is_super_admin = (email == SUPER_ADMIN_EMAIL)
    is_admin = is_super_admin

    if is_super_admin:
        # Super Admin has its OWN passcode — separate from the Admin Common
        # Passcode every regular Administrator also knows, since that shared
        # code shouldn't be able to unlock the single super-admin account.
        if passcode not in [super_admin_passcode, DEFAULT_SUPER_ADMIN_PASSCODE]:
            return Response({
                "success": False,
                "error": {
                    "code": "INVALID_CREDENTIALS",
                    "message": "Invalid Super Admin passcode provided.",
                    "details": {}
                }
            }, status=status.HTTP_401_UNAUTHORIZED)
    else:
        # Check if existing registered user
        user_check = AuthorizedUser.objects.filter(email=email).first()
        if user_check and user_check.is_admin:
            is_admin = True

        if is_admin or passcode == admin_passcode:
            is_admin = True
            if passcode != admin_passcode:
                return Response({
                    "success": False,
                    "error": {
                        "code": "INVALID_CREDENTIALS",
                        "message": "Invalid Administrator passcode provided.",
                        "details": {}
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
        else:
            if passcode != attendee_passcode:
                return Response({
                    "success": False,
                    "error": {
                        "code": "INVALID_CREDENTIALS",
                        "message": "Invalid event passcode provided.",
                        "details": {}
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)

    user = AuthorizedUser.objects.filter(email=email).first()

    if not user:
        # Bootstrap Super Admin or Demo Attendee
        if is_super_admin or email in ['admin@chennaimath.org', 'attendee@example.com'] or AuthorizedUser.objects.count() == 0:
            user = AuthorizedUser.objects.create(
                email=email,
                is_admin=is_admin,
                is_super_admin=is_super_admin,
                is_active=True
            )
        else:
            return Response({
                "success": False,
                "error": {
                    "code": "NOT_AUTHORIZED",
                    "message": "This email address is not registered for the live stream event. Please contact event support.",
                    "details": {}
                }
            }, status=status.HTTP_403_FORBIDDEN)

    if not user.is_active:
        return Response({
            "success": False,
            "error": {
                "code": "USER_DISABLED",
                "message": "Your user account has been deactivated by an administrator.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    user.last_login_at = timezone.now()
    if is_super_admin and not user.is_super_admin:
        user.is_super_admin = True
        user.is_admin = True
    user.save(update_fields=['last_login_at', 'is_super_admin', 'is_admin'])

    token, refresh_token, session_id = generate_jwt_token(user.id, user.email, user.is_admin, user.is_super_admin)
    SessionManager.set_active_session(str(user.id), user.email, session_id)

    return Response({
        "success": True,
        "data": {
            "token": token,
            "refresh_token": refresh_token,
            "user": AuthorizedUserSerializer(user).data,
            "session_id": session_id
        }
    })

@api_view(['POST'])
def refresh_token_view(request):
    """
    Exchanges a still-valid REFRESH token for a fresh ACCESS token (and a
    rotated refresh token), without requiring the event passcode again.
    Intentionally NOT behind @enforce_active_session — that decorator only
    accepts access tokens, and the whole point here is renewing one using a
    token that's specifically NOT an access token.
    """
    refresh_token = request.data.get('refresh_token')
    if not refresh_token:
        return Response({
            "success": False,
            "error": {
                "code": "REFRESH_TOKEN_REQUIRED",
                "message": "A refresh_token is required.",
                "details": {}
            }
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        payload = decode_jwt_token(refresh_token)
    except ValueError as e:
        return Response({
            "success": False,
            "error": {"code": "INVALID_TOKEN", "message": str(e), "details": {}}
        }, status=status.HTTP_401_UNAUTHORIZED)

    if payload.get('type') != 'refresh':
        return Response({
            "success": False,
            "error": {"code": "INVALID_TOKEN", "message": "This is not a valid refresh token.", "details": {}}
        }, status=status.HTTP_401_UNAUTHORIZED)

    user_id = payload.get('user_id')
    session_id = payload.get('session_id')

    session_status = SessionManager.check_session_status(user_id, session_id)
    if session_status == 'evicted':
        return Response({
            "success": False,
            "error": {
                "code": "SESSION_EVICTED",
                "message": "Your session has been revoked because your account was logged in from another device.",
                "details": {}
            }
        }, status=status.HTTP_401_UNAUTHORIZED)
    if session_status == 'not_found':
        # Redis/cache entry expired (e.g. server restart) but the refresh
        # token itself is still cryptographically valid — re-register the
        # session rather than forcing a full re-login over a technicality.
        SessionManager.set_active_session(str(user_id), payload.get('email', ''), session_id)

    # Refuse to renew a session for an account that's been disabled or
    # deleted since the refresh token was issued.
    user = AuthorizedUser.objects.filter(id=user_id).first()
    if not user or not user.is_active:
        return Response({
            "success": False,
            "error": {
                "code": "USER_DISABLED",
                "message": "Your user account is no longer active.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    new_access_token, new_refresh_token, _ = generate_jwt_token(
        user_id, payload.get('email', ''), payload.get('is_admin', False), payload.get('is_super_admin', False),
        session_id=session_id
    )

    return Response({
        "success": True,
        "data": {
            "token": new_access_token,
            "refresh_token": new_refresh_token,
        }
    })

@api_view(['POST'])
@enforce_active_session
def heartbeat_view(request):
    claims = request.user_claims
    user_id = claims.get('user_id')
    session_id = claims.get('session_id')

    updated = SessionManager.update_heartbeat(user_id, session_id)
    return Response({
        "success": True,
        "data": {
            "active": updated
        }
    })

@api_view(['POST'])
@enforce_active_session
def logout_view(request):
    claims = request.user_claims
    SessionManager.invalidate_session(claims.get('user_id'))
    return Response({
        "success": True,
        "data": {
            "message": "Logged out successfully."
        }
    })

@api_view(['GET'])
@require_admin
def live_metrics_view(request):
    metrics = SessionManager.get_live_metrics()
    return Response({
        "success": True,
        "data": metrics
    })

@api_view(['POST'])
@require_admin
def create_single_user_view(request):
    """
    Admin endpoint to add a single user or new administrator.
    Only Super Admin can create new Administrators.
    """
    claims = request.user_claims
    is_super = claims.get('is_super_admin', False)

    serializer = CreateUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data['email']
    role = serializer.validated_data['role']

    if role == 'admin' and not is_super:
        return Response({
            "success": False,
            "error": {
                "code": "PERMISSION_DENIED",
                "message": "Only the Super Administrator (events@chennaimath.org) can register new Administrators.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    new_user = AuthorizedUser.objects.create(
        email=email,
        is_admin=(role == 'admin'),
        is_super_admin=False,
        is_active=True
    )

    return Response({
        "success": True,
        "data": AuthorizedUserSerializer(new_user).data
    }, status=status.HTTP_201_CREATED)

@api_view(['PATCH'])
@require_admin
def toggle_user_status_view(request, user_id):
    """
    Enable or Disable user access. If disabled, evicts the active session immediately.
    Super Admin privileges required to modify Admin status.
    """
    claims = request.user_claims
    is_super = claims.get('is_super_admin', False)

    try:
        target_user = AuthorizedUser.objects.get(id=user_id)
    except AuthorizedUser.DoesNotExist:
        return Response({
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "User not found.",
                "details": {}
            }
        }, status=status.HTTP_404_NOT_FOUND)

    if target_user.is_super_admin:
        return Response({
            "success": False,
            "error": {
                "code": "PERMISSION_DENIED",
                "message": "Super Administrator status cannot be toggled.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    if target_user.is_admin and not is_super:
        return Response({
            "success": False,
            "error": {
                "code": "PERMISSION_DENIED",
                "message": "Only the Super Administrator can enable or disable Administrators.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    target_user.is_active = not target_user.is_active
    target_user.save(update_fields=['is_active'])

    # Evict active session if user was disabled
    if not target_user.is_active:
        SessionManager.invalidate_session(str(target_user.id))

    return Response({
        "success": True,
        "data": AuthorizedUserSerializer(target_user).data
    })

@api_view(['DELETE'])
@require_super_admin
def delete_user_view(request, user_id):
    """
    Delete a user from the roster (Super Admin only).
    """
    try:
        target_user = AuthorizedUser.objects.get(id=user_id)
    except AuthorizedUser.DoesNotExist:
        return Response({
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "User not found.",
                "details": {}
            }
        }, status=status.HTTP_404_NOT_FOUND)

    if target_user.is_super_admin:
        return Response({
            "success": False,
            "error": {
                "code": "PERMISSION_DENIED",
                "message": "Super Administrator account cannot be deleted.",
                "details": {}
            }
        }, status=status.HTTP_403_FORBIDDEN)

    SessionManager.invalidate_session(str(target_user.id))
    target_user.delete()

    return Response({
        "success": True,
        "data": {"message": "User deleted successfully."}
    })

@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@require_admin
def bulk_import_users_view(request):
    serializer = BulkUserImportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    validated_emails = serializer.validated_data['validated_emails']
    invalid_entries = serializer.validated_data['invalid_entries']

    created_count = 0
    existing_count = 0

    existing_emails = set(AuthorizedUser.objects.filter(email__in=validated_emails).values_list('email', flat=True))

    new_users = []
    for email in validated_emails:
        if email in existing_emails:
            existing_count += 1
        else:
            new_users.append(AuthorizedUser(email=email, is_active=True))
            created_count += 1

    if new_users:
        AuthorizedUser.objects.bulk_create(new_users, ignore_conflicts=True)

    return Response({
        "success": True,
        "data": {
            "created_count": created_count,
            "existing_count": existing_count,
            "invalid_entries": invalid_entries,
            "total_processed": len(validated_emails)
        }
    })

@api_view(['GET'])
@require_admin
def list_users_view(request):
    users = AuthorizedUser.objects.all().order_by('-created_at')[:500]
    serializer = AuthorizedUserSerializer(users, many=True)
    return Response({
        "success": True,
        "data": {
            "users": serializer.data,
            "total_count": AuthorizedUser.objects.count()
        }
    })

@api_view(['GET', 'POST'])
@require_super_admin
def system_config_view(request):
    """
    View or update every system passcode (attendee, admin, and super admin).
    Super Admin only — regular Administrators have no access to this
    endpoint at all (enforced by @require_super_admin, not a per-field
    check), since these passcodes gate access to the whole event.
    """
    if request.method == 'GET':
        return Response({
            "success": True,
            "data": {
                "common_passcode": get_system_passcode('COMMON_PASSCODE', DEFAULT_PASSCODE),
                "admin_passcode": get_system_passcode('ADMIN_PASSCODE', DEFAULT_ADMIN_PASSCODE),
                "super_admin_passcode": get_system_passcode('SUPER_ADMIN_PASSCODE', DEFAULT_SUPER_ADMIN_PASSCODE),
                "is_super_admin": True
            }
        })
    else:
        new_attendee_passcode = request.data.get('common_passcode', '').strip()
        new_admin_passcode = request.data.get('admin_passcode', '').strip()
        new_super_admin_passcode = request.data.get('super_admin_passcode', '').strip()

        if new_attendee_passcode:
            config, _ = SystemConfig.objects.get_or_create(key='COMMON_PASSCODE')
            config.value = new_attendee_passcode
            config.save()

        if new_admin_passcode:
            config, _ = SystemConfig.objects.get_or_create(key='ADMIN_PASSCODE')
            config.value = new_admin_passcode
            config.save()

        if new_super_admin_passcode:
            config, _ = SystemConfig.objects.get_or_create(key='SUPER_ADMIN_PASSCODE')
            config.value = new_super_admin_passcode
            config.save()

        return Response({
            "success": True,
            "data": {
                "message": "System passcodes updated successfully."
            }
        })
