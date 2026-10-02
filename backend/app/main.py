import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.routers import (
    academics,
    admin,
    admissions,
    announcements,
    auth,
    codes,
    materials,
    notifications,
    public,
    results,
    students,
    teachers,
    users,
)
from app.routers import settings as settings_router

settings = get_settings()
log = logging.getLogger("school")


def bootstrap_defaults() -> None:
    """Ensures singleton rows required by the app exist."""
    from app.create_admin import bootstrap_super_admin_from_environment
    from app.models import GradingScale
    from app.services.access import get_school
    from app.services.grading import install_default_scale

    with SessionLocal() as db:
        get_school(db)
        if not db.scalars(select(GradingScale.id).limit(1)).first():
            install_default_scale(db)
        bootstrap_super_admin_from_environment(db)
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.assert_safe()
    if settings.auto_create_tables:
        Base.metadata.create_all(engine)
    bootstrap_defaults()
    yield


def create_app() -> FastAPI:
    docs = None if settings.is_production else "/docs"
    app = FastAPI(
        title="School Portal API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=docs,
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # Allowed origin origins list merging system settings with exact deployment domains
    allowed_origins = list(
        {
            "http://localhost:5173",
            "http://localhost:3000",
            "https://school-website-mauve-one.vercel.app",
            *getattr(settings, "cors_list", []),
        }
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=600,
    )

    max_body = (settings.max_upload_mb * 4 + 2) * 1024 * 1024

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > max_body:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        response = await call_next(request)
        h = response.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if not request.url.path.startswith(("/docs", "/openapi")):
            h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if settings.is_production:
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors()[:5]:
            loc = ".".join(str(p) for p in err["loc"] if p not in ("body", "query", "path"))
            msg = err["msg"].removeprefix("Value error, ")
            parts.append(f"{loc}: {msg}" if loc else msg)
        return JSONResponse({"detail": "; ".join(parts) or "Invalid input"}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)

    @app.get("/api/health", tags=["meta"])
    def health():
        with SessionLocal() as db:
            db.execute(select(1))
        return {"status": "ok"}

    for r in (
        auth.router, users.router, students.router, teachers.router, academics.router, results.router,
        codes.router, public.router, materials.router, announcements.router, notifications.router,
        admissions.router, settings_router.router, admin.router,
    ):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
