from django.db import models
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
