# RestrictLive — One-Command Docker Setup & Deployment Manual

With Docker, you do **not** need to install Python, Node.js, virtual environments, or database tools on your host machine. **A single command sets up the entire application automatically.**

---

## ⚡ 1. The 1-Command Setup (Works on any machine with Docker)

### Step 1: Clone the repository
```bash
git clone https://github.com/your-org/restrict_live.git
cd restrict_live
```

### Step 2: Run the 1-Command Docker Launch
```bash
docker compose up -d --build
```

### ✨ What Docker does automatically in this single command:
1. Downloads and launches **PostgreSQL 16** & **Redis 7** containers.
2. Builds the **Auth Service** & **Stream Service** microservices.
3. Automatically runs all **Database Migrations** (`python manage.py migrate`).
4. Automatically seeds the **Super Admin** (`events@chennaimath.org`), default passcodes (`ADMIN2026`, `IRK2026`), and stream video configuration.
5. Launches tuned **Gunicorn** WSGI workers and the **Nginx Gateway**.

---

## 🌐 2. Exposing to the Internet (Dev Sharing & Production)

### Option A: Temporary Dev Sharing via ngrok
To share your local running instance over the internet:
```bash
# In your terminal
ngrok http 5173
```
Share the generated `https://xxxx-xxxx.ngrok-free.app` URL with anyone! Only 1 ngrok tunnel is needed because Vite proxies all API requests internally.

---

### Option B: Production Server Deployment (1000+ Viewers)

1. **Spin up a Linux VPS** (AWS EC2 / DigitalOcean / Linode with Ubuntu 22.04 / 24.04).
2. **Install Docker**: `sudo apt update && sudo apt install -y docker.io docker-compose-plugin git`
3. **Run 1-Command Launch**:
   ```bash
   git clone https://github.com/your-org/restrict_live.git
   cd restrict_live
   docker compose up -d --build
   ```
4. **Point Domain & Enable Free SSL (Cloudflare / Certbot)**:
   - **Cloudflare**: Point your domain `A Record` to your server IP, enable Proxy (Orange Cloud), set SSL mode to **Full**.
   - **Certbot Direct**: `sudo certbot --nginx -d live.yourdomain.com`

---

## 🔑 Default Initial Credentials

| Account Role | Email | Passcode |
| :--- | :--- | :--- |
| **Super Admin** | `events@chennaimath.org` | `ADMIN2026` |
| **Admin** | `admin@chennaimath.org` | `ADMIN2026` |
| **Attendee** | `attendee@example.com` | `IRK2026` |

---

## 🛠️ Optional: Non-Docker Manual Setup (Legacy / Alternative)

If you explicitly choose not to use Docker, you can run services manually:

```bash
# Auth Service (Port 8000)
cd services/auth_service
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000

# Stream Service (Port 8001)
cd ../stream_service
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8001

# Frontend (Port 5173)
cd ../../frontend
npm install
npm run dev
```
