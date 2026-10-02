from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, has_perm, require_perm
from app.core.permissions import Role
from app.core.security import generate_temp_password, hash_password
from app.models import User
from app.schemas import UserUpdate
from app.services.accounts import user_payload

router = APIRouter(prefix="/users", tags=["users"])


def _guard_target(db, actor: User, target: User) -> None:
    if target.role in (Role.ADMIN.value, Role.SUPER_ADMIN.value) and not has_perm(db, actor, "users.manage_admins"):
        raise HTTPException(403, "Only a super admin can manage administrator accounts")
    if target.role == Role.SUPER_ADMIN.value and actor.role != Role.SUPER_ADMIN.value:
        raise HTTPException(403, "Only a super admin can manage a super admin")


@router.get("")
def list_users(
    db: DB,
    user: User = Depends(require_perm("users.manage")),
    q: str | None = None,
    role: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    page_size = min(max(page_size, 1), 100)
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if user.role != Role.SUPER_ADMIN.value:
        stmt = stmt.where(User.role != Role.SUPER_ADMIN.value)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.username).like(like), func.lower(User.email).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(User.full_name).offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
    return {"items": [user_payload(db, u) | {"permissions": None} for u in rows], "total": total, "page": page, "page_size": page_size}


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, request: Request, db: DB, actor: User = Depends(require_perm("users.manage"))):
    target = get_or_404(db, User, user_id, "User")
    _guard_target(db, actor, target)
    data = body.model_dump(exclude_unset=True)
    if "email" in data and data["email"]:
        clash = db.scalars(select(User).where(func.lower(User.email) == data["email"].lower(), User.id != target.id)).first()
        if clash:
            raise HTTPException(409, "That email is already in use")
        data["email"] = data["email"].lower()
    for k, v in data.items():
        setattr(target, k, v)
    audit(db, request, actor, "USER_UPDATE", "user", target.id, {"fields": list(data)})
    db.commit()
    return user_payload(db, target) | {"permissions": None}


@router.post("/{user_id}/{action}")
def user_action(user_id: int, action: str, request: Request, db: DB, actor: User = Depends(require_perm("users.manage"))):
    if action not in ("activate", "deactivate", "reset-password"):
        raise HTTPException(404, "Not found")
    target = get_or_404(db, User, user_id, "User")
    _guard_target(db, actor, target)
    result: dict = {"ok": True}
    if action == "reset-password":
        temp = generate_temp_password()
        target.password_hash = hash_password(temp)
        target.must_change_password = True
        target.failed_attempts, target.locked_until = 0, None
        result["temporary_password"] = temp
        audit(db, request, actor, "USER_PASSWORD_RESET", "user", target.id)
    else:
        if target.id == actor.id and action == "deactivate":
            raise HTTPException(400, "You cannot deactivate your own account")
        target.is_active = action == "activate"
        audit(db, request, actor, "USER_ACTIVATE" if target.is_active else "USER_DEACTIVATE", "user", target.id)
    db.commit()
    return result
