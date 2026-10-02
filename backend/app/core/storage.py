import re
import secrets
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

from app.core.config import get_settings

settings = get_settings()
_KEY_RE = re.compile(r"^[a-z0-9_]+/[a-f0-9]{32}\.[a-z0-9]{1,5}$")


def new_key(folder: str, ext: str) -> str:
    return f"{folder}/{secrets.token_hex(16)}.{ext.lower().lstrip('.')}"


def _check_key(key: str) -> None:
    if not _KEY_RE.match(key):
        raise ValueError("invalid storage key")


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def response(self, key: str, filename: str, content_type: str, inline: bool) -> Response: ...


def _disposition(filename: str, inline: bool) -> str:
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", filename)[:150] or "file"
    return f'{"inline" if inline else "attachment"}; filename="{safe}"'


class LocalStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        _check_key(key)
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def response(self, key: str, filename: str, content_type: str, inline: bool) -> Response:
        p = self._path(key)
        if not p.exists():
            raise HTTPException(404, "File not found")
        return FileResponse(
            p,
            media_type=content_type,
            headers={
                "Content-Disposition": _disposition(filename, inline),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=300",
            },
        )


class S3Storage:
    def __init__(self) -> None:
        import boto3

        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            region_name=settings.s3_region or None,
            endpoint_url=settings.s3_endpoint_url or None,
            aws_access_key_id=settings.s3_access_key_id or None,
            aws_secret_access_key=settings.s3_secret_access_key or None,
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        _check_key(key)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def read(self, key: str) -> bytes:
        _check_key(key)
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        _check_key(key)
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def response(self, key: str, filename: str, content_type: str, inline: bool) -> Response:
        _check_key(key)
        url = self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseContentDisposition": _disposition(filename, inline),
            },
            ExpiresIn=300,
        )
        return RedirectResponse(url, status_code=302)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = S3Storage() if settings.storage_backend == "s3" else LocalStorage(settings.local_storage_dir)
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None
