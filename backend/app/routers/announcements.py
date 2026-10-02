from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, has_perm, require_perm
from app.core.notify import notify
from app.core.permissions import Role
from app.core.ratelimit import rate_limit
from app.core.security import utcnow
from app.core.storage import get_storage, new_key
from app.core.uploads import process_image
from app.models import Announcement, User
from app.schemas import AnnouncementIn

router = APIRouter(tags=["announcements"])
write = require_perm("announcements.write")


def announcement_dict(a: Announcement, full: bool = True) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "body": a.body if full else (a.body[:220] + ("…" if len(a.body) > 220 else "")),
        "category": a.category,
        "event_date": a.event_date,
        "image_url": f"/api/public/announcements/{a.id}/image" if a.image_key and a.is_public else (f"/api/announcements/{a.id}/image" if a.image_key else None),
        "author": a.author.full_name if a.author else None,
        "status": a.status,
        "is_public": a.is_public,
        "published_at": a.published_at,
        "expires_at": a.expires_at,
        "created_at": a.created_at,
    }


def _live(stmt):
    now = utcnow()
    return stmt.where(Announcement.status == "PUBLISHED", or_(Announcement.expires_at.is_(None), Announcement.expires_at > now))


@router.get("/public/announcements")
def public_announcements(db: DB, category: str | None = None, page: int = 1, page_size: int = 10):
    page_size = min(max(page_size, 1), 50)
    stmt = _live(select(Announcement)).where(Announcement.is_public.is_(True))
    if category:
        stmt = stmt.where(Announcement.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(
        stmt.options(joinedload(Announcement.author)).order_by(func.coalesce(Announcement.published_at, Announcement.created_at).desc())
        .offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [announcement_dict(a) for a in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/public/announcements/{aid}/image")
def public_image(aid: int, db: DB):
    a = db.scalars(_live(select(Announcement).where(Announcement.id == aid, Announcement.is_public.is_(True)))).first()
    if not a or not a.image_key:
        raise HTTPException(404, "Not found")
    return get_storage().response(a.image_key, "announcement.jpg", "image/jpeg", True)


@router.get("/announcements/{aid}/image")
def private_image(aid: int, db: DB, user: CurrentUser):
    a = get_or_404(db, Announcement, aid, "Announcement")
    if not a.image_key or (a.status != "PUBLISHED" and user.role in (Role.STUDENT.value, Role.TEACHER.value)):
        raise HTTPException(404, "Not found")
    return get_storage().response(a.image_key, "announcement.jpg", "image/jpeg", True)


@router.get("/announcements")
def list_announcements(db: DB, user: CurrentUser, status: str | None = None, category: str | None = None, page: int = 1, page_size: int = 20):
    page_size = min(max(page_size, 1), 100)
    manager = has_perm(db, user, "announcements.write")
    stmt = select(Announcement)
    if manager:
        if status:
            stmt = stmt.where(Announcement.status == status)
    else:
        stmt = _live(stmt)
    if category:
        stmt = stmt.where(Announcement.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(
        stmt.options(joinedload(Announcement.author)).order_by(func.coalesce(Announcement.published_at, Announcement.created_at).desc())
        .offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [announcement_dict(a) for a in rows], "total": total, "page": page, "page_size": page_size, "can_manage": manager}


def _on_publish(db, a: Announcement) -> None:
    a.published_at = utcnow()
    ids = db.scalars(select(User.id).where(User.is_active.is_(True), User.role.in_([Role.STUDENT.value, Role.TEACHER.value]))).all()
    notify(db, ids, "New announcement", a.title, "/portal/announcements")


@router.post("/announcements", status_code=201)
def create_announcement(body: AnnouncementIn, request: Request, db: DB, user: User = Depends(write)):
    a = Announcement(**body.model_dump(), author_id=user.id)
    db.add(a)
    db.flush()
    if a.status == "PUBLISHED":
        _on_publish(db, a)
    audit(db, request, user, "ANNOUNCEMENT_CREATE", "announcement", a.id, {"title": a.title, "status": a.status})
    db.commit()
    return announcement_dict(a)


@router.put("/announcements/{aid}")
def update_announcement(aid: int, body: AnnouncementIn, request: Request, db: DB, user: User = Depends(write)):
    a = get_or_404(db, Announcement, aid, "Announcement")
    was = a.status
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    if a.status == "PUBLISHED" and was != "PUBLISHED":
        _on_publish(db, a)
    audit(db, request, user, "ANNOUNCEMENT_UPDATE", "announcement", a.id, {"status": a.status})
    db.commit()
    return announcement_dict(a)


@router.post("/announcements/{aid}/image")
async def upload_image(aid: int, file: UploadFile, request: Request, db: DB, user: User = Depends(write)):
    a = get_or_404(db, Announcement, aid, "Announcement")
    data, ext, mime = await process_image(file, 1400, max_mb=5)
    storage = get_storage()
    key = new_key("announcements", ext)
    storage.put(key, data, mime)
    old, a.image_key = a.image_key, key
    audit(db, request, user, "ANNOUNCEMENT_IMAGE", "announcement", a.id)
    db.commit()
    if old:
        try:
            storage.delete(old)
        except Exception:
            pass
    return announcement_dict(a)


@router.delete("/announcements/{aid}", status_code=204)
def delete_announcement(aid: int, request: Request, db: DB, user: User = Depends(write)):
    a = get_or_404(db, Announcement, aid, "Announcement")
    key = a.image_key
    audit(db, request, user, "ANNOUNCEMENT_DELETE", "announcement", a.id, {"title": a.title})
    db.delete(a)
    db.commit()
    if key:
        try:
            get_storage().delete(key)
        except Exception:
            pass
