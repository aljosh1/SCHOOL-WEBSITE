# School Portal

A school website and student-management portal for a Nigerian primary or secondary school. It includes a public-facing website and a role-based portal for school administrators, teachers, and students.

## Stack

- Frontend: React, TypeScript, Vite, and Tailwind CSS
- Backend: FastAPI, SQLAlchemy, and Pydantic
- Database: SQLite by default for local development; PostgreSQL is supported
- File storage: local by default; S3-compatible storage is supported

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and API overview.

## Requirements

- Python 3.10 or later
- Node.js and npm

## Run Locally

Open two terminals from the repository root.

### Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`. In development, interactive API documentation is at `http://127.0.0.1:8000/docs`. The default configuration creates a local SQLite database and local storage directory as needed.

### Frontend

```powershell
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`) for the public homepage. The sign-in page is at `http://localhost:5173/login`, or use the “Student Portal” link. Vite proxies `/api` requests to the local backend. To use a different API host, set `VITE_API_URL` in `frontend/.env`; to change the local Vite proxy target, set `VITE_API_PROXY` in the environment before starting the dev server.

## Demo Data

With the backend virtual environment active and the current directory set to `backend/`, run:

```powershell
python -m app.seed
```

This creates clearly labelled demo school data and demo accounts. Use it only with a development database; the seed script refuses to run when `ENVIRONMENT=production`. Running it with `--reset` drops and recreates the configured database.

## Checks

Run backend tests from `backend/`:

```powershell
python -m pytest
```

Run frontend checks from `frontend/`:

```powershell
npm run typecheck
npm run build
```

## Configuration and Deployment

- Backend settings are documented in `backend/.env.example`. Copy it to `backend/.env` for local overrides.
- Frontend configuration is documented in `frontend/.env.example`.
- Never commit real environment files or production secrets. Set strong, unique `SECRET_KEY` and `CODE_PEPPER` values in production.
- Set `ENVIRONMENT=production`, configure a PostgreSQL `DATABASE_URL`, allowed `CORS_ORIGINS`, and the desired storage and mail settings before deployment.
- The frontend includes Vercel configuration in `frontend/vercel.json`.# SCHOOL-WEBSITE
