from django.db import models
from django.utils import timezone
import uuid

class AuthorizedUser(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, db_index=True)
    is_active = models.BooleanField(default=True)
    is_admin = models.BooleanField(default=False)
    is_super_admin = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'auth_authorized_users'
        ordering = ['-created_at']

    def __str__(self):
        role = 'Super Admin' if self.is_super_admin else ('Admin' if self.is_admin else 'Attendee')
        return f"{self.email} ({role})"

class SystemConfig(models.Model):
    key = models.CharField(max_length=50, primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'auth_system_config'

    def __str__(self):
        return f"{self.key}: {self.value}"

class FailureLog(models.Model):
    """
    Audit trail of user-facing failures (failed logins, failed Q&A
    submissions/upvotes, etc) for the admin dashboard's "Logs" tab. Deliberately
    NOT prefixed `auth_` in its table name (unlike this app's other tables)
    because stream_service also writes into it directly, via raw SQL, since
    both services share one physical Postgres database — see
    services/common/failure_log.py for the shared write helper.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.CharField(max_length=255, blank=True, default='', db_index=True)
    category = models.CharField(max_length=50, db_index=True)
    description = models.TextField()
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = 'failure_log'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.category}] {self.email or 'unknown'} @ {self.created_at}"
