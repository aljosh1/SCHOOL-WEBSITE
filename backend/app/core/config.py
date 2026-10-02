import secrets
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET = "dev-only-secret-do-not-use-in-production"
_DEV_PEPPER = "dev-only-code-pepper-do-not-use-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite:///./school.db"
    secret_key: str = _DEV_SECRET
    code_pepper: str = _DEV_PEPPER
    access_token_minutes: int = 480
    cors_origins: str = "http://localhost:5173"
    frontend_url: str = "http://localhost:5173"
    auto_create_tables: bool = True
    trust_proxy_headers: bool = False

    max_upload_mb: int = 15
    storage_backend: str = "local"
    local_storage_dir: str = "./storage"
    s3_bucket: str = ""
    s3_region: str = "auto"
    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""

    clamav_host: str = ""
    clamav_port: int = 3310

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@example.com"

    login_max_failures: int = 5
    login_lock_minutes: int = 15
    result_check_ip_limit: int = 12  # failed attempts per IP per window
    result_check_student_limit: int = 8  # failed attempts per student ref per window
    result_check_window_minutes: int = 15

    @field_validator("secret_key", "code_pepper", mode="before")
    @classmethod
    def _empty_to_dev(cls, v: str, info) -> str:
        if v:
            return v
        return _DEV_SECRET if info.field_name == "secret_key" else _DEV_PEPPER

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        return url

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def assert_safe(self) -> None:
        if self.is_production and (self.secret_key == _DEV_SECRET or self.code_pepper == _DEV_PEPPER):
            raise RuntimeError("SECRET_KEY and CODE_PEPPER must be set in production")
        if self.is_production and len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must be at least 32 characters")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def random_secret() -> str:
    return secrets.token_urlsafe(64)
