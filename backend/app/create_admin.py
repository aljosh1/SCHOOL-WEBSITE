from getpass import getpass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.permissions import Role
from app.core.security import password_is_strong
from app.models import User
from app.services.accounts import create_user


def create_first_super_admin(db: Session, username: str, full_name: str, password: str) -> User:
    if db.scalar(select(User.id).limit(1)) is not None:
        raise RuntimeError("Refusing to bootstrap: the users table is not empty.")
    if not password_is_strong(password):
        raise ValueError("Password must be 8-128 characters and include letters and numbers.")

    user, _ = create_user(
        db,
        username=username,
        full_name=full_name,
        role=Role.SUPER_ADMIN.value,
        password=password,
    )
    db.commit()
    return user


def main() -> None:
    print("Create the initial super admin for this database.")
    username = input("Username: ").strip()
    full_name = input("Full name: ").strip()
    if not username or len(username) > 80:
        raise SystemExit("Username must be between 1 and 80 characters.")
    if not full_name or len(full_name) > 200:
        raise SystemExit("Full name must be between 1 and 200 characters.")

    password = getpass("Password (input hidden): ")
    if password != getpass("Confirm password: "):
        raise SystemExit("Passwords do not match.")

    with SessionLocal() as db:
        try:
            user = create_first_super_admin(db, username, full_name, password)
        except (RuntimeError, ValueError) as exc:
            db.rollback()
            raise SystemExit(str(exc)) from exc

    print(f"Created super admin '{user.username}'. You can now sign in.")


if __name__ == "__main__":
    main()