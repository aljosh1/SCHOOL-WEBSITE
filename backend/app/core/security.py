import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

settings = get_settings()
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-equalisation")

# No 0/O/1/I/L to keep printed cards readable.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


_PW_RULE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,128}$")


def password_is_strong(password: str) -> bool:
    return bool(_PW_RULE.match(password))


def generate_temp_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
    core = "".join(secrets.choice(alphabet) for _ in range(9))
    return f"{core}{secrets.choice('23456789')}"


def create_access_token(user_id: int, role: str) -> str:
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "typ": "access",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_token(token: str, expected_type: str = "access") -> dict | None:
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == expected_type else None


def create_scoped_token(typ: str, claims: dict, minutes: int) -> str:
    now = utcnow()
    return jwt.encode(
        {**claims, "typ": typ, "iat": now, "exp": now + timedelta(minutes=minutes)},
        settings.secret_key,
        algorithm="HS256",
    )


def generate_access_code(prefix: str = "SCH") -> str:
    groups = ["".join(secrets.choice(CODE_ALPHABET) for _ in range(4)) for _ in range(3)]
    return f"{prefix}-" + "-".join(groups)


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


def hash_code(code: str) -> str:
    """Keyed hash over the normalised code, so formatting differences do not matter."""
    return hmac.new(settings.code_pepper.encode(), normalize_code(code).encode(), hashlib.sha256).hexdigest()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_reset_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def new_verification_ref() -> str:
    return "VR-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
