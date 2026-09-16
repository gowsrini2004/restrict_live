FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY services/auth_service/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt gunicorn gevent

COPY services/ /app/services/

WORKDIR /app/services/auth_service
RUN chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
