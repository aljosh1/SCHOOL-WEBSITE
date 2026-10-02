from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import permissions_for
from app.core.security import generate_temp_password, hash_password, password_is_strong
from app.models import Student, Teacher, User


def create_user(
    db: Session,
    *,
    username: str,
    full_name: str,
    role: str,
    email: str | None = None,
    phone: str | None = None,
    password: str | None = None,
    is_demo: bool = False,
) -> tuple[User, str | None]:
    """Returns (user, temporary_password_if_generated)."""
    if db.scalars(select(User).where(User.username.ilike(username))).first():
        raise HTTPException(409, "That username is already taken")
    if email and db.scalars(select(User).where(User.email.ilike(email))).first():
        raise HTTPException(409, "That email is already in use")
    temp = None
    if password is None:
        temp = password = generate_temp_password()
    elif not password_is_strong(password):
        raise HTTPException(422, "Password must be at least 8 characters and include letters and numbers")
    user = User(
        username=username,
        email=email.lower() if email else None,
        full_name=full_name,
        phone=phone,
        role=role,
        password_hash=hash_password(password),
        must_change_password=temp is not None,
        is_demo=is_demo,
    )
    db.add(user)
    db.flush()
    return user, temp


def user_payload(db: Session, user: User) -> dict:
    teacher = db.scalars(select(Teacher.id).where(Teacher.user_id == user.id)).first()
    student = db.scalars(select(Student.id).where(Student.user_id == user.id)).first()
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "is_active": user.is_active,
        "is_demo": user.is_demo,
        "must_change_password": user.must_change_password,
        "last_login_at": user.last_login_at,
        "teacher_id": teacher,
        "student_id": student,
        "permissions": sorted(permissions_for(db, user.role)),
    }
