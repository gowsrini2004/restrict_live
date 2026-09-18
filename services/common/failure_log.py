import uuid
import logging
from django.db import connection
from django.utils import timezone

logger = logging.getLogger(__name__)

# Keep this in sync with the migration that creates the `failure_log` table
# (auth_service/users/migrations) and with the category filter dropdown in
# frontend/src/pages/AdminDashboardPage.tsx.
CATEGORY_LOGIN_INVALID_CREDENTIALS = 'LOGIN_INVALID_CREDENTIALS'
CATEGORY_LOGIN_NOT_AUTHORIZED = 'LOGIN_NOT_AUTHORIZED'
CATEGORY_LOGIN_ACCOUNT_DISABLED = 'LOGIN_ACCOUNT_DISABLED'
CATEGORY_LOGIN_VALIDATION_ERROR = 'LOGIN_VALIDATION_ERROR'
CATEGORY_QNA_SUBMIT_FAILED = 'QNA_SUBMIT_FAILED'
CATEGORY_QNA_UPVOTE_FAILED = 'QNA_UPVOTE_FAILED'

CATEGORY_LABELS = {
    CATEGORY_LOGIN_INVALID_CREDENTIALS: 'Login — Wrong Passcode',
    CATEGORY_LOGIN_NOT_AUTHORIZED: 'Login — Email Not Registered',
    CATEGORY_LOGIN_ACCOUNT_DISABLED: 'Login — Account Disabled',
    CATEGORY_LOGIN_VALIDATION_ERROR: 'Login — Invalid Input',
    CATEGORY_QNA_SUBMIT_FAILED: 'Q&A — Submit Failed',
    CATEGORY_QNA_UPVOTE_FAILED: 'Q&A — Upvote Failed',
}


def log_failure(email, category, description):
    """
    Best-effort write into the shared `failure_log` table. The table is
    owned and migrated by auth_service (services/auth_service/users/models.py),
    but stream_service writes to it too — both services already sit on the
    same physical Postgres database (see docker-compose.yml), so a raw INSERT
    here avoids stream_service needing its own copy of the model/migration
    history for a table it doesn't own.

    Never raises — a logging hiccup must never turn into a 500 on the real
    user-facing failure it's trying to record.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO failure_log (id, email, category, description, created_at) "
                "VALUES (%s, %s, %s, %s, %s)",
                [str(uuid.uuid4()), (email or '')[:255], category, description, timezone.now()]
            )
    except Exception:
        logger.exception("Failed to write failure_log entry (category=%s)", category)
