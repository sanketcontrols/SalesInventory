# PostgreSQL Setup Guide

## Windows Installation

### Option 1: Install PostgreSQL locally
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. Run the installer and follow the setup wizard
3. Remember the password you set for the `postgres` user
4. Default port is 5432

### Option 2: Docker (if you have Docker installed)
```bash
docker run --name billing_db -e POSTGRES_PASSWORD=password -d -p 5432:5432 postgres:15
```

## Database Configuration

The backend uses the following environment variables (in `.env`):
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/billing_system
NODE_ENV=development
PORT=5000
```

### Customize Connection String

If your PostgreSQL setup is different, update `.env`:
- `postgres` = PostgreSQL username
- `password` = PostgreSQL password (change this!)
- `localhost` = PostgreSQL host
- `5432` = PostgreSQL port
- `billing_system` = Database name

## Verification

1. Start PostgreSQL server
2. The backend will automatically create tables and insert demo data
3. Check the backend console for: "Database tables created successfully"

## Demo Credentials

After database setup:
- Email: admin@example.com
- Password: 123456
