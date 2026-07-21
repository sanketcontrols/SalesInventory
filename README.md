# Purn Sanket Electrols — Sales & Inventory

Billing, orders, customers, products, and inventory management.

## Important: do not use GitHub Pages

GitHub Pages only hosts static files. This app needs **Node.js + PostgreSQL**, so Pages will always show **404 / File not found**.

**Turn Pages off:** GitHub repo → **Settings** → **Pages** → Source → **None**.

Deploy with Docker or a VPS instead (see below).

## Run locally (development)

```bash
# Terminal 1 — API + database (see SETUP.md / backend/.env)
cd backend
npm install
npm start

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`).

## Deploy (production)

Use **Docker Compose** on a VPS or your own machine:

```bash
cp .env.docker.example .env
# Edit .env — set DB_PASSWORD and JWT_SECRET

docker compose up -d --build
```

App URL: `http://YOUR_SERVER_IP:5000`

Full options: [DEPLOY.md](./DEPLOY.md)

## Repo

- GitHub: https://github.com/sanketcontrols/SalesInventory
- Default admin (first run): see `DEPLOY.md` — change the password after login
