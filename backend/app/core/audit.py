from fastapi import Request
from sqlalchemy.orm import Session

from app.core.ratelimit import client_ip
from app.models import AuditLog, User


def audit(
    db: Session,
    request: Request | None,
    user: User | None,
    action: str,
    entity: str | None = None,
    entity_id: int | str | None = None,
    detail: dict | None = None,
) -> None:
    """Adds an audit row to the caller's transaction (committed with the change)."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            detail=detail,
            ip=client_ip(request) if request else None,
            user_agent=(request.headers.get("user-agent", "")[:255] if request else None),
        )
    )
