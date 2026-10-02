from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, require_perm
from app.core.storage import get_storage, new_key
from app.core.uploads import process_image
from app.models import Result, SchoolSettings, User
from app.schemas import SettingsIn
from app.services import access
from app.services.grading import active_entries, validate_scale

router = APIRouter(tags=["settings"])
ASSET_FIELDS = {"logo": "logo_key", "stamp": "stamp_key", "signature": "signature_key", "hero": "hero_key"}
PUBLIC_ASSETS = {"logo", "hero"}
ASSET_SIZE = {"logo": 600, "stamp": 600, "signature": 600, "hero": 1800}


def full_settings(s: SchoolSettings) -> dict:
    cols = {c.name: getattr(s, c.name) for c in SchoolSettings.__table__.columns}
    for kind, field in ASSET_FIELDS.items():
        cols[f"has_{kind}"] = bool(cols.pop(field))
    cols["updated_at"] = s.updated_at
    cols.pop("created_at", None)
    return cols


def public_school(db, s: SchoolSettings) -> dict:
    sess = access.current_session(db)
    term = access.current_term(db, sess.id if sess else None)
    v = int(s.updated_at.timestamp()) if s.updated_at else 0
    return {
        "name": s.name,
        "short_name": s.short_name,
        "motto": s.motto,
        "address": s.address,
        "phone": s.phone,
        "email": s.email,
        "website": s.website,
        "facebook": s.facebook,
        "instagram": s.instagram,
        "twitter": s.twitter,
        "youtube": s.youtube,
        "map_embed_url": s.map_embed_url,
        "primary_color": s.primary_color,
        "secondary_color": s.secondary_color,
        "principal_name": s.principal_name,
        "principal_title": s.principal_title,
        "principal_message": s.principal_message,
        "history": s.history,
        "vision": s.vision,
        "mission": s.mission,
        "philosophy": s.philosophy,
        "core_values": s.core_values or [],
        "logo_url": f"/api/public/media/logo?v={v}" if s.logo_key else None,
        "hero_url": f"/api/public/media/hero?v={v}" if s.hero_key else None,
        "current_session": {"id": sess.id, "name": sess.name} if sess else None,
        "current_term": {"id": term.id, "name": term.name} if term else None,
        "code_prefix": s.code_prefix,
    }


@router.get("/settings")
def get_settings_endpoint(db: DB, _: User = Depends(require_perm("settings.manage"))):
    s = access.get_school(db)
    db.commit()
    return full_settings(s)


@router.put("/settings")
def update_settings(body: SettingsIn, request: Request, db: DB, user: User = Depends(require_perm("settings.manage"))):
    s = access.get_school(db)
    data = body.model_dump(exclude_unset=True)
    for key in ("name", "short_name", "primary_color", "secondary_color", "ca_max", "exam_max", "require_approval",
                "allow_teacher_self_approval", "show_position", "code_prefix", "code_default_max_uses", "code_default_expiry_days"):
        if key in data and data[key] is None:
            data.pop(key)
    new_ca, new_exam = data.get("ca_max", s.ca_max), data.get("exam_max", s.exam_max)
    if new_ca < s.ca_max or new_exam < s.exam_max:
        over = db.scalar(
            select(func.count()).select_from(Result).where((Result.ca_score > new_ca) | (Result.exam_score > new_exam))
        )
        if over:
            raise HTTPException(409, f"{over} existing result(s) exceed the new maximum score. Correct them first.")
    changed = {k: v for k, v in data.items() if getattr(s, k) != v}
    for k, v in data.items():
        setattr(s, k, v)
    if "ca_max" in changed or "exam_max" in changed:
        # grading bands must still reach the new maximum
        entries = active_entries(db)
        if entries:
            validate_scale([(e.min_score, e.max_score) for e in entries], s.ca_max + s.exam_max)
    audit(db, request, user, "SETTINGS_UPDATE", "settings", s.id, {"fields": sorted(changed)})
    db.commit()
    return full_settings(s)


@router.post("/settings/assets/{kind}")
async def upload_asset(kind: str, file: UploadFile, request: Request, db: DB, user: User = Depends(require_perm("settings.manage"))):
    if kind not in ASSET_FIELDS:
        raise HTTPException(404, "Unknown asset")
    data, ext, mime = await process_image(file, ASSET_SIZE[kind], max_mb=5, allow_png=kind != "hero")
    s = access.get_school(db)
    storage = get_storage()
    key = new_key("assets", ext)
    storage.put(key, data, mime)
    old = getattr(s, ASSET_FIELDS[kind])
    setattr(s, ASSET_FIELDS[kind], key)
    audit(db, request, user, "SETTINGS_ASSET_UPLOAD", "settings", s.id, {"asset": kind})
    db.commit()
    if old:
        try:
            storage.delete(old)
        except Exception:
            pass
    return full_settings(s)


def _asset_response(s: SchoolSettings, kind: str) -> Response:
    key = getattr(s, ASSET_FIELDS[kind])
    if not key:
        raise HTTPException(404, "Not set")
    mime = "image/png" if key.endswith(".png") else "image/jpeg"
    return get_storage().response(key, f"{kind}.{key.rsplit('.', 1)[-1]}", mime, inline=True)


@router.get("/settings/assets/{kind}")
def get_asset(kind: str, db: DB, _: User = Depends(require_perm("settings.manage"))):
    if kind not in ASSET_FIELDS:
        raise HTTPException(404, "Unknown asset")
    return _asset_response(access.get_school(db), kind)


@router.get("/public/media/{kind}")
def public_media(kind: str, db: DB):
    if kind not in PUBLIC_ASSETS:
        raise HTTPException(404, "Not found")
    return _asset_response(access.get_school(db), kind)


@router.get("/public/school")
def public_school_info(db: DB):
    s = access.get_school(db)
    db.commit()
    return public_school(db, s)
