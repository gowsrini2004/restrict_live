#!/bin/sh
set -e

echo "Running auth service migrations..."
python manage.py migrate --noinput

echo "Seeding default Super Admin and passcodes..."
python manage.py shell -c "
from users.models import User, SystemConfig
User.objects.get_or_create(email='events@chennaimath.org', defaults={'role':'SUPER_ADMIN','is_active':True})
SystemConfig.objects.get_or_create(key='common_admin_passcode', defaults={'value':'ADMIN2026'})
SystemConfig.objects.get_or_create(key='attendee_passcode', defaults={'value':'IRK2026'})
"

echo "Starting Auth Service Gunicorn..."
exec gunicorn --workers 4 --worker-class gevent --worker-connections 1000 --bind 0.0.0.0:8000 auth_service.wsgi:application
