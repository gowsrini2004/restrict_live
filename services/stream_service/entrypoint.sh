#!/bin/sh
set -e

echo "Running stream service migrations..."
python manage.py migrate --fake-initial --noinput

echo "Seeding default stream configuration..."
python manage.py shell -c "
from stream_app.models import StreamConfig
StreamConfig.objects.get_or_create(
    id='2a6b7a49-944e-462c-b031-279429c5a217',
    defaults={
        'title': 'International Retreat 2026 — Live Stream',
        'youtube_url': 'https://youtu.be/jfKfPfyJRdk',
        'youtube_video_id': 'jfKfPfyJRdk',
        'is_live': True
    }
)
"

echo "Starting Stream Service Gunicorn..."
exec gunicorn --workers 4 --worker-class gevent --worker-connections 1000 --bind 0.0.0.0:8001 stream_service.wsgi:application
