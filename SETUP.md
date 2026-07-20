# Billing System - PostgreSQL Setup

## Quick Start Options

### Option 1: Using Docker (Easiest - No Installation Required)

If you have Docker installed:

```bash
cd f:\Billing System
docker-compose up -d
```

This will:
- Create a PostgreSQL container named `billing_postgres`
- Setup database `billing_system`
- Username: `postgres`
- Password: `password`
- Port: `5432`

Then start the backend:
```bash
cd backend
node server.js
```

### Option 2: Local PostgreSQL Installation

#### Windows Installation:
1. **Download PostgreSQL:** https://www.postgresql.org/download/windows/
2. **Run installer** - Follow setup wizard
3. **Remember:** The password you set for `postgres` user (default port: 5432)
4. **Create database:**
   - Open pgAdmin or SQL Shell
   - Run:
   ```sql
   CREATE DATABASE billing_system;
   ```
5. **Update .env file** if credentials differ:
   ```
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/billing_system
   ```
6. **Start backend:**
   ```bash
   cd backend
   node server.js
   ```

### Option 3: PostgreSQL on Cloud

Use services like:
- **ElephantSQL** (https://www.elephantsql.com) - Free tier available
- **Heroku Postgres**
- **AWS RDS**
- **Azure Database for PostgreSQL**

Then update the `DATABASE_URL` in `.env` with the cloud connection string.

## Verification

After setup, the backend console should show:
```
Backend running on http://localhost:5000
Connected to PostgreSQL database
Database tables created successfully
Demo user created
```

## Default Demo Credentials

After database initialization:
- **Email:** admin@example.com
- **Password:** 123456

## Troubleshooting

If you see `ECONNREFUSED`:
- PostgreSQL is not running
- Check the port (default: 5432)
- Verify credentials in `.env`

If you see `EADDRINUSE`:
- Port 5000 is already in use
- Kill the process or change the PORT in `.env`
