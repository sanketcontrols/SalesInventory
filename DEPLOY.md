# Deploy Purn Sanket Electrols

This app has a **React frontend** and **Node.js + PostgreSQL backend**. The easiest way to deploy is **Docker Compose** (one command, includes database).

> **Do not use GitHub Pages.** Pages cannot run this app (no Node, no database). Enabling Pages causes a **404 File not found**. Use Docker or a VPS instead. In the repo: **Settings → Pages → Source → None**.

---

## Option 1: Docker (recommended)

Works on any VPS (DigitalOcean, AWS, Hostinger, etc.) or your own server with Docker installed.

### Requirements
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Steps

1. **Copy env file and set secrets**
   ```bash
   cp .env.docker.example .env
   ```
   Edit `.env` and change:
   - `DB_PASSWORD` — strong database password
   - `JWT_SECRET` — long random string (e.g. 32+ characters)

2. **Build and start**
   ```bash
   docker compose up -d --build
   ```

3. **Open the app**
   - URL: `http://YOUR_SERVER_IP:5000`
   - Default admin (created on first run if DB is empty):
     - Email: `harsh@gmail.com`
     - Password: `123456`
   - **Change the admin password after first login.**

4. **Useful commands**
   ```bash
   docker compose logs -f app    # view logs
   docker compose ps             # status
   docker compose down           # stop
   docker compose up -d --build  # rebuild after code changes
   ```

5. **Custom domain + HTTPS (optional)**  
   Put [Nginx](https://nginx.org/) or [Caddy](https://caddyserver.com/) in front of port 5000 and add SSL (Let’s Encrypt).

---

## Option 2: Synology NAS (office local deploy)

Best for keeping **app + PostgreSQL inside your office** on Synology.

### What you need
- Synology NAS with **Container Manager** (DSM 7) or **Docker** (older DSM)
- At least **2 GB free RAM** recommended
- NAS local IP (example: `192.168.1.50`)

### A. Install Container Manager
1. Synology **Package Center** → search **Container Manager** → Install  
2. Open **Container Manager**

### B. Put project files on NAS
1. In **File Station**, create folder: `docker/salesinventory`
2. Copy your whole project into that folder (from PC or GitHub):
   - `Dockerfile`
   - `docker-compose.yml`
   - `.env`
   - `frontend/`
   - `backend/`
   - etc.

Or via SSH:
```bash
cd /volume1/docker
git clone https://github.com/sanketcontrols/SalesInventory.git salesinventory
cd salesinventory
```

### C. Create `.env` on NAS
In `docker/salesinventory` create file `.env`:
```env
# IMPORTANT on Synology: DSM already uses port 5000 — do NOT use 5000
APP_PORT=5080
DB_HOST_PORT=5433
DB_NAME=billing
DB_USER=postgres
DB_PASSWORD=ChooseAStrongPassword123
JWT_SECRET=ChooseALongRandomSecretKeyForJWT
```

### D. Start with Container Manager (Compose)
1. Container Manager → **Project** → **Create**
2. Path: `/docker/salesinventory` (or where you put files)
3. Source: `docker-compose.yml`
4. Create / Build / Start
5. Wait until both containers are **Running**:
   - `salesinventory-db-1` (PostgreSQL)
   - `salesinventory-app-1` (your app)

### E. Open the app in office
- `http://NAS_IP:5080`  
  Example: `http://192.168.1.50:5080`

> Synology DSM already uses **port 5000**. Postgres on NAS often uses **5432**.  
> Compose defaults: app **5080**, DB host port **5433**. If you still see  
> `driver failed programming external connectivity`, pick other free ports in `.env`.

First login (empty DB):
- Email: `harsh@gmail.com`
- Password: `123456`  
Change password after login.

### F. Copy your current data into NAS Postgres (optional)
From your PC (with PostgreSQL tools):

1. Export from current DB (Render or local):
```bash
pg_dump -h YOUR_CURRENT_HOST -p 5432 -U YOUR_USER -d YOUR_DB -F c -f billing_backup.dump
```

2. Restore into Synology Postgres (port mapped if needed):
```bash
pg_restore --clean --if-exists --no-owner --no-acl -h NAS_IP -p 5432 -U postgres -d billing billing_backup.dump
```

If Postgres port is only inside Docker network, use:
```bash
# on NAS via SSH
cd /volume1/docker/salesinventory
sudo docker compose exec -T db pg_restore --clean --if-exists --no-owner --no-acl -U postgres -d billing < billing_backup.dump
```
(Copy the dump file onto NAS first.)

### G. Useful Synology commands (SSH)
Enable SSH: **Control Panel → Terminal & SNMP → Enable SSH**

```bash
cd /volume1/docker/salesinventory
sudo docker compose ps
sudo docker compose logs -f app
sudo docker compose up -d --build    # after code update
sudo docker compose down             # stop
```

### H. Office network tips
- Keep NAS on a **fixed LAN IP**
- Open port **5000** only on office LAN (not public internet unless you use VPN / reverse proxy)
- Optional: Synology **Login Portal / Reverse Proxy** for HTTPS with office domain

### Point local PC app to NAS DB (optional)
If you want PC development to use NAS database, set `backend/.env`:
```env
DB_HOST=192.168.1.50
DB_PORT=5432
DB_NAME=billing
DB_USER=postgres
DB_PASSWORD=ChooseAStrongPassword123
JWT_SECRET=same-as-nas
```
And expose Postgres in `docker-compose.yml` ports:
```yaml
ports:
  - "5432:5432"
```
Only do this on a trusted office network.

---

## Option 3: VPS without Docker (manual)

For Ubuntu/Debian VPS with Node 22 and PostgreSQL already installed.

### 1. Database
```bash
sudo -u postgres psql
CREATE DATABASE billing;
CREATE USER billing_user WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE billing TO billing_user;
\q
```

### 2. Backend env
Create `backend/.env`:
```env
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=billing
DB_USER=billing_user
DB_PASSWORD=your-password
JWT_SECRET=your-long-random-secret
```

### 3. Build frontend and copy to backend
```bash
cd frontend
npm ci
npm run build
mkdir -p ../backend/public
cp -r dist/* ../backend/public/
```

### 4. Start backend
```bash
cd ../backend
npm ci --omit=dev
NODE_ENV=production node server.js
```

Use **PM2** to keep it running:
```bash
npm install -g pm2
pm2 start server.js --name billing --cwd /path/to/backend
pm2 save
pm2 startup
```

### 5. Nginx reverse proxy (example)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Option 3: Deploy on Render (recommended cloud)

Use **one Web Service** (UI + API) + **one PostgreSQL**. Tables are created automatically on first start.

### A. PostgreSQL

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **PostgreSQL**
2. Name e.g. `billing-db`, same region you will use for the app
3. Create → wait until **Available**
4. Copy the **Internal Database URL**

### B. Web Service

1. **New** → **Web Service** → connect GitHub repo
2. Runtime: **Node**
3. Root Directory: leave empty
4. **Build Command:**
   ```bash
   cd frontend && npm ci && npm run build && mkdir -p ../backend/public && cp -r dist/* ../backend/public/ && cd ../backend && npm ci --omit=dev
   ```
5. **Start Command:**
   ```bash
   cd backend && node server.js
   ```

### C. Environment variables

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Internal Database URL from step A |
| `JWT_SECRET` | Long random secret (32+ characters) |
| `DB_SSL` | `true` |

Do **not** set `PORT` — Render provides it.

### D. After deploy

1. Open `https://YOUR-SERVICE.onrender.com`
2. Health check: `/api/health` → `{"status":"ok","database":"connected"}`
3. Login (first empty DB):
   - Email: `harsh@gmail.com`
   - Password: `123456`
4. Change password in Settings immediately

### E. Optional: copy local data to Render

```bash
pg_dump -h localhost -p 5433 -U postgres -d harsh -F c -f billing_backup.dump
```

Restore into Render using the **External Database URL** with `pg_restore` or a GUI (DBeaver / pgAdmin).

### F. Troubleshooting on Render

| Problem | Fix |
|---------|-----|
| DB / SSL errors | `DB_SSL=true` + Internal `DATABASE_URL` |
| Blank page | Confirm build copies into `backend/public` |
| Slow first load | Free tier sleeps; wait ~30s or upgrade |
| CORS errors | Only if UI is on another domain — set `CORS_ORIGIN` |

### Separate frontend (Vercel) + API (Render)

1. Deploy backend as above  
2. Frontend build env: `VITE_API_URL=https://your-api.onrender.com`  
3. Backend env: `CORS_ORIGIN=https://your-frontend.vercel.app`

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes (prod) | Set to `production` |
| `PORT` | No | Default `5000` |
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | Default `5432` |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `JWT_SECRET` | Yes | Secret for login tokens — use a strong random value |
| `DB_SSL` | Recommended on Render | Set `true` for managed Postgres (Render, etc.) |
| `CORS_ORIGIN` | No | Only if frontend is on a different domain |
| `VITE_API_URL` | No | Frontend build only; empty when API is same origin |

---

## Production checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Change default admin password (`harsh@gmail.com`)
- [ ] Use HTTPS (SSL certificate)
- [ ] Back up PostgreSQL regularly
- [ ] Do not commit `.env` files to git

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `database disconnected` | Check DB credentials and that PostgreSQL is running |
| Blank page after deploy | Rebuild frontend and ensure files are in `backend/public` |
| Login works locally but not live | Check `JWT_SECRET` is set; clear browser cache / log out |
| CORS errors | Set `CORS_ORIGIN` to your frontend URL |

Health check: `GET /api/health` should return `{"status":"ok","database":"connected"}`.
