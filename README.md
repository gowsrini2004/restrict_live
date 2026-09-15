# RestrictLive — High-Concurrency Secure Live Streaming Platform

RestrictLive is a high-concurrency, mobile-responsive live streaming and live Q&A platform built with React, Vite, Tailwind CSS, Django REST Framework, PostgreSQL, Redis, and Nginx.

---

## ⚡ 1-Command Automated Launch with Docker

With Docker, you do **not** need to manually install Python, virtual environments, Node.js, or database drivers. Everything (migrations, seed data, Redis, Postgres, Gunicorn, Nginx) runs automatically in **a single command**:

```bash
git clone https://github.com/your-org/restrict_live.git
cd restrict_live

# 1-Command Launch:
docker compose up -d --build
```

### ✨ Automated by Docker in this single command:
- Runs PostgreSQL 16 & Redis 7 databases.
- Applies all Django database migrations (`python manage.py migrate`).
- Seeds the default Super Admin (`events@chennaimath.org`), passcodes (`ADMIN2026`, `IRK2026`), and stream video config.
- Launches tuned Gunicorn WSGI workers & Nginx Gateway.

---

## 🌐 Sharing via ngrok (Dev Sharing)

```bash
ngrok http 5173
```
Share the generated `https://xxxx-xxxx.ngrok-free.app` URL with anyone!

---

## 🔑 Default Initial Credentials

| Account Role | Email | Passcode |
| :--- | :--- | :--- |
| **Super Admin** | `events@chennaimath.org` | `ADMIN2026` |
| **Admin** | `admin@chennaimath.org` | `ADMIN2026` |
| **Attendee** | `attendee@example.com` | `IRK2026` |

---

## 📖 Full Documentation
- See [DEPLOYMENT.md](file:///f:/restrict_live/DEPLOYMENT.md) for full production deployment, SSL setup, and troubleshooting details.