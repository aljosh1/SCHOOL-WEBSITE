from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select, update

from app.core.deps import DB, CurrentUser
from app.models import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(db: DB, user: CurrentUser, unread_only: bool = False, page: int = 1, page_size: int = 20):
    page_size = min(max(page_size, 1), 100)
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False)))
    rows = db.scalars(stmt.order_by(Notification.id.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
    return {
        "items": [{"id": n.id, "title": n.title, "message": n.message, "link": n.link, "is_read": n.is_read, "created_at": n.created_at} for n in rows],
        "total": total,
        "unread": unread,
        "page": page,
        "page_size": page_size,
    }


@router.post("/read-all")
def read_all(db: DB, user: CurrentUser):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False)).values(is_read=True))
    db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: DB, user: CurrentUser):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}
