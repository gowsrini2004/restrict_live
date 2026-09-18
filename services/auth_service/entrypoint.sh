#!/bin/sh
set -e

echo "Running auth service migrations..."
python manage.py migrate --noinput

echo "Seeding default Super Admin and passcodes..."
python manage.py shell -c "
from users.models import AuthorizedUser, SystemConfig
AuthorizedUser.objects.get_or_create(email='events@chennaimath.org', defaults={'is_admin': True, 'is_super_admin': True, 'is_active': True})
AuthorizedUser.objects.get_or_create(email='admin@chennaimath.org', defaults={'is_admin': True, 'is_super_admin': False, 'is_active': True})
AuthorizedUser.objects.get_or_create(email='attendee@example.com', defaults={'is_admin': False, 'is_super_admin': False, 'is_active': True})
SystemConfig.objects.get_or_create(key='ADMIN_PASSCODE', defaults={'value': '183663'})
SystemConfig.objects.get_or_create(key='SUPER_ADMIN_PASSCODE', defaults={'value': 'Mother108*'})
SystemConfig.objects.get_or_create(key='COMMON_PASSCODE', defaults={'value': 'IRK2026'})
"

echo "Starting Auth Service Gunicorn..."
exec gunicorn --workers 4 --worker-class gevent --worker-connections 1000 --bind 0.0.0.0:8000 auth_service.wsgi:application
