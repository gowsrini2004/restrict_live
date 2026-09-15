FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY services/stream_service/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt gunicorn gevent

COPY services/ /app/services/

WORKDIR /app/services/stream_service

EXPOSE 8001

# Production WSGI server with gunicorn gevent workers tuned for high concurrency (1000+ users)
CMD ["gunicorn", "--workers", "4", "--worker-class", "gevent", "--worker-connections", "1000", "--bind", "0.0.0.0:8001", "stream_service.wsgi:application"]
