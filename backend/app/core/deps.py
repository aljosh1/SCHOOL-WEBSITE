import time
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import DEFAULTS, Role
from app.core.security import decode_token
from app.models import RolePermission, User

_bearer = HTTPBearer(auto_error=False)
DB = Annotated[Session, Depends(get_db)]

_perm_cache: dict[str, tuple[float, set[str]]] = {}
_TTL = 30.0


def invalidate_permission_cache() -> None:
    _perm_cache.clear()


def permissions_for(db: Session, role: str) -> set[str]:
    if role == Role.SUPER_ADMIN.value:
        return set(DEFAULTS[role])
    hit = _perm_cache.get(role)
    if hit and time.monotonic() - hit[0] < _TTL:
        return hit[1]
    rows = db.scalars(select(RolePermission.permission).where(RolePermission.role == role)).all()
    # No rows for a role means "use defaults"; an explicit empty set is stored as a sentinel.
    perms = {p for p in rows if p != "__none__"} if rows else set(DEFAULTS.get(role, set()))
    _perm_cache[role] = (time.monotonic(), perms)
    return perms


def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    unauthorized = HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if not creds:
        raise unauthorized
    data = decode_token(creds.credentials)
    if not data:
        raise unauthorized
    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_perm(*perms: str, any_of: bool = False):
    def dep(user: CurrentUser, db: DB) -> User:
        have = permissions_for(db, user.role)
        ok = any(p in have for p in perms) if any_of else all(p in have for p in perms)
        if not ok:
            raise HTTPException(403, "You do not have permission to perform this action")
        return user

    return dep


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    def dep(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(403, "You do not have permission to perform this action")
        return user

    return dep


def is_staff_admin(user: User) -> bool:
    return user.role in (Role.SUPER_ADMIN.value, Role.ADMIN.value)


def has_perm(db: Session, user: User, perm: str) -> bool:
    return perm in permissions_for(db, user.role)


def not_found(what: str = "Record") -> HTTPException:
    return HTTPException(404, f"{what} not found")


def get_or_404(db: Session, model, pk: int, what: str | None = None):
    obj = db.get(model, pk)
    if obj is None:
        raise not_found(what or model.__name__)
    return obj
