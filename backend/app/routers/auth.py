from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from app.core.audit import audit
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, has_perm
from app.core.notify import send_email
from app.core.permissions import Role
from app.core.ratelimit import rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_reset_token,
    password_is_strong,
    password_needs_rehash,
    utcnow,
    verify_password,
)
from app.models import PasswordResetToken, User
from app.schemas import ChangePasswordIn, ForgotPasswordIn, LoginIn, ResetPasswordIn, UserCreate
from app.services.accounts import create_user, user_payload

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
GENERIC_LOGIN_ERROR = "Incorrect username or password"


@router.post("/login", dependencies=[Depends(rate_limit("login", 30, 60))])
def login(body: LoginIn, request: Request, db: DB):
    user = db.scalars(select(User).where(func.lower(User.username) == body.username.lower())).first()
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        audit(db, request, user, "LOGIN_BLOCKED", "user", user.id)
        db.commit()
        raise HTTPException(429, "Too many failed attempts. Try again later.")
    ok = verify_password(body.password, user.password_hash if user else None)
    if not user or not ok or not user.is_active:
        if user and not ok:
            user.failed_attempts += 1
            if user.failed_attempts >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_attempts = 0
        audit(db, request, user, "LOGIN_FAILED", "user", user.id if user else None, {"username": body.username[:80]})
        db.commit()
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    user.failed_attempts, user.locked_until, user.last_login_at = 0, None, now
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    audit(db, request, user, "LOGIN", "user", user.id)
    db.commit()
    return {"access_token": create_access_token(user.id, user.role), "token_type": "bearer", "user": user_payload(db, user)}


@router.get("/me")
def me(user: CurrentUser, db: DB):
    return user_payload(db, user)


@router.post("/register", status_code=201)
def register(body: UserCreate, request: Request, user: CurrentUser, db: DB):
    if body.role in ("ADMIN", "SUPER_ADMIN"):
        if not has_perm(db, user, "users.manage_admins"):
            raise HTTPException(403, "Only a super admin can create administrators")
    elif not has_perm(db, user, "users.manage"):
        raise HTTPException(403, "You do not have permission to perform this action")
    if body.role == Role.SUPER_ADMIN.value and user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(403, "Only a super admin can create a super admin")
    new, temp = create_user(
        db, username=body.username, full_name=body.full_name, role=body.role, email=body.email, phone=body.phone, password=body.password
    )
    audit(db, request, user, "USER_CREATE", "user", new.id, {"role": new.role, "username": new.username})
    db.commit()
    return {"user": user_payload(db, new), "temporary_password": temp}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, user: CurrentUser, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if not password_is_strong(body.new_password):
        raise HTTPException(422, "Password must be at least 8 characters and include letters and numbers")
    if body.new_password == body.current_password:
        raise HTTPException(422, "New password must be different from the current one")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    audit(db, request, user, "PASSWORD_CHANGE", "user", user.id)
    db.commit()
    return {"ok": True}


@router.post("/forgot-password", status_code=202, dependencies=[Depends(rate_limit("forgot", 5, 900))])
def forgot_password(body: ForgotPasswordIn, request: Request, db: DB):
    ident = body.identifier.lower()
    user = db.scalars(
        select(User).where(User.is_active.is_(True), (func.lower(User.username) == ident) | (func.lower(User.email) == ident))
    ).first()
    if user and user.email:
        raw, hashed = new_reset_token()
        db.add(PasswordResetToken(user_id=user.id, token_hash=hashed, expires_at=utcnow() + timedelta(hours=1)))
        audit(db, request, user, "PASSWORD_RESET_REQUEST", "user", user.id)
        db.commit()
        link = f"{settings.frontend_url.rstrip('/')}/reset-password?token={raw}"
        send_email(user.email, "Reset your password", f"Hello {user.full_name},\n\nUse this link within 1 hour to reset your password:\n{link}\n\nIgnore this email if you did not ask for it.")
    return {"message": "If the account exists and has an email address, a reset link has been sent."}


@router.post("/reset-password", dependencies=[Depends(rate_limit("reset", 10, 900))])
def reset_password(body: ResetPasswordIn, request: Request, db: DB):
    row = db.scalars(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(body.token))).first()
    if not row or row.used_at or row.expires_at < utcnow():
        raise HTTPException(400, "This reset link is invalid or has expired")
    if not password_is_strong(body.new_password):
        raise HTTPException(422, "Password must be at least 8 characters and include letters and numbers")
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.failed_attempts, user.locked_until = 0, None
    row.used_at = utcnow()
    audit(db, request, user, "PASSWORD_RESET", "user", user.id)
    db.commit()
    return {"ok": True}
