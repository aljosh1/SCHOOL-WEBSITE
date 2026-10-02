import gzip
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func, select

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, invalidate_permission_cache, permissions_for, require_perm
from app.core.permissions import DEFAULTS, EDITABLE_ROLES, PERMISSIONS, STUDENT_ALLOWED, Role
from app.core.security import utcnow
from app.core.storage import get_storage, new_key
from app.models import (
    Announcement,
    AuditLog,
    Backup,
    Base,
    ClassArm,
    Enrollment,
    LearningMaterial,
    Notification,
    ReportCard,
    Result,
    ResultAccessCode,
    RolePermission,
    SchoolClass,
    Student,
    Subject,
    Teacher,
    User,
)
from app.schemas import PermissionsIn
from app.services import access
from app.services.grading import active_entries
from app.routers.codes import summary as code_summary

router = APIRouter(tags=["admin"])


# ------------------------------------------------------------------ audit log


@router.get("/audit-logs")
def audit_logs(
    db: DB,
    _: User = Depends(require_perm("audit.read")),
    action: str | None = None,
    q: str | None = None,
    entity: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 30,
):
    page_size = min(max(page_size, 1), 100)
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where((func.lower(func.coalesce(AuditLog.username, "")).like(like)) | (func.lower(func.coalesce(AuditLog.entity_id, "")).like(like)) | (func.lower(AuditLog.action).like(like)))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time()).replace(tzinfo=utcnow().tzinfo))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()).replace(tzinfo=utcnow().tzinfo))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
    return {
        "items": [
            {"id": a.id, "user": a.username, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "detail": a.detail,
             "ip": a.ip, "user_agent": a.user_agent, "created_at": a.created_at}
            for a in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/audit-logs/actions")
def audit_actions(db: DB, _: User = Depends(require_perm("audit.read"))):
    return [a for (a,) in db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action))]


# ------------------------------------------------------------------ dashboards


@router.get("/dashboard")
def admin_dashboard(db: DB, user: User = Depends(require_perm("reports.read"))):
    if user.role not in (Role.SUPER_ADMIN.value, Role.ADMIN.value):
        raise HTTPException(403, "You do not have permission to perform this action")
    sess = access.current_session(db)
    term = access.current_term(db, sess.id if sess else None)

    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(*where))

    status_rows = dict(
        db.execute(
            select(Result.status, func.count()).where(Result.term_id == (term.id if term else -1)).group_by(Result.status)
        ).all()
    )
    by_class = db.execute(
        select(SchoolClass.name, func.count(Enrollment.id))
        .join(Enrollment, (Enrollment.class_id == SchoolClass.id) & (Enrollment.session_id == (sess.id if sess else -1)), isouter=True)
        .group_by(SchoolClass.id, SchoolClass.name, SchoolClass.level_order)
        .order_by(SchoolClass.level_order, SchoolClass.name)
    ).all()
    subj_avg = db.execute(
        select(Subject.name, func.avg(Result.total))
        .join(Result, Result.subject_id == Subject.id)
        .where(Result.term_id == (term.id if term else -1), Result.status == "PUBLISHED")
        .group_by(Subject.id, Subject.name)
        .order_by(Subject.name)
    ).all()
    entries = active_entries(db)
    dist: dict[str, int] = {e.grade: 0 for e in entries}
    for (g,) in db.execute(select(Result.grade).where(Result.term_id == (term.id if term else -1), Result.status == "PUBLISHED")):
        if g in dist:
            dist[g] += 1
    codes = code_summary(db, user)
    recent = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(10)).all()
    return {
        "session": sess.name if sess else None,
        "term": term.name if term else None,
        "totals": {
            "students": count(Student, Student.status == "ACTIVE"),
            "teachers": count(Teacher),
            "classes": count(SchoolClass),
            "subjects": count(Subject, Subject.is_active.is_(True)),
            "materials": count(LearningMaterial),
            "report_cards": count(ReportCard),
            "pending_results": status_rows.get("SUBMITTED", 0),
            "published_results": status_rows.get("PUBLISHED", 0),
            "codes_generated": codes["TOTAL"],
            "codes_used": codes["USED"] + codes["EXHAUSTED"],
            "codes_available": codes["UNUSED"],
        },
        "charts": {
            "students_by_class": [{"name": n, "value": v} for n, v in by_class],
            "results_by_status": [{"name": k, "value": status_rows.get(k, 0)} for k in ("DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED")],
            "subject_averages": [{"name": n, "value": round(float(a), 1)} for n, a in subj_avg],
            "grade_distribution": [{"name": k, "value": v} for k, v in dist.items()],
            "code_usage": [{"name": k.title(), "value": codes[k]} for k in ("UNUSED", "USED", "EXHAUSTED", "EXPIRED", "DISABLED")],
        },
        "recent_activity": [{"id": a.id, "user": a.username, "action": a.action, "entity": a.entity, "created_at": a.created_at} for a in recent],
    }


@router.get("/dashboard/student")
def student_dashboard(db: DB, user: CurrentUser):
    if user.role != Role.STUDENT.value:
        raise HTTPException(403, "This dashboard is for students")
    from app.routers.announcements import _live, announcement_dict
    from app.routers.materials import subject_tiles
    from app.routers.results import history
    from app.routers.students import class_label, student_dict

    s = access.student_for(db, user)
    if not s:
        raise HTTPException(404, "No student profile is linked to this account")
    sess = access.current_session(db)
    e = access.current_enrollment(db, s.id) or access.latest_enrollment(db, s.id)
    hist = history(db, user)
    latest = hist[0]["terms"][0] if hist and hist[0]["terms"] else None
    anns = db.scalars(_live(select(Announcement)).order_by(func.coalesce(Announcement.published_at, Announcement.created_at).desc()).limit(5)).all()
    return {
        "student": student_dict(s, e),
        "current_session": sess.name if sess else None,
        "class_name": class_label(e),
        "latest_result": latest,
        "history": hist,
        "announcements": [announcement_dict(a, full=False) for a in anns],
        "subjects": subject_tiles(db, user, None),
    }


# ------------------------------------------------------------------ permissions matrix


@router.get("/permissions")
def get_permissions(db: DB, _: User = Depends(require_perm("permissions.manage"))):
    return {
        "permissions": [{"key": k, "description": v} for k, v in PERMISSIONS.items()],
        "matrix": {r: sorted(permissions_for(db, r)) for r in (Role.SUPER_ADMIN.value, *EDITABLE_ROLES)},
        "editable_roles": list(EDITABLE_ROLES),
        "defaults": {r: sorted(DEFAULTS[r]) for r in EDITABLE_ROLES},
    }


@router.put("/permissions")
def put_permissions(body: PermissionsIn, request: Request, db: DB, user: User = Depends(require_perm("permissions.manage"))):
    for role, perms in body.matrix.items():
        unknown = set(perms) - set(PERMISSIONS)
        if unknown:
            raise HTTPException(422, f"Unknown permission(s): {', '.join(sorted(unknown))}")
        if role == Role.STUDENT.value and set(perms) - STUDENT_ALLOWED:
            raise HTTPException(422, "Students may only be granted: " + ", ".join(sorted(STUDENT_ALLOWED)))
        if role == Role.ADMIN.value and {"users.manage_admins", "backups.manage", "permissions.manage"} & set(perms):
            raise HTTPException(422, "Administrator-management, backup and permission rights are reserved for the super admin")
        for old in db.scalars(select(RolePermission).where(RolePermission.role == role)):
            db.delete(old)
        db.flush()
        for p in sorted(set(perms)) or ["__none__"]:
            db.add(RolePermission(role=role, permission=p))
    audit(db, request, user, "PERMISSIONS_UPDATE", "permissions", None, {"roles": sorted(body.matrix)})
    db.commit()
    invalidate_permission_cache()
    return get_permissions(db, user)


# ------------------------------------------------------------------ backups


def _json_default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    return str(o)


@router.get("/backups")
def list_backups(db: DB, _: User = Depends(require_perm("backups.manage"))):
    rows = db.scalars(select(Backup).order_by(Backup.id.desc()).limit(100)).all()
    return [{"id": b.id, "size_bytes": b.size_bytes, "created_at": b.created_at, "created_by": (db.get(User, b.created_by_id).full_name if b.created_by_id else None)} for b in rows]


@router.post("/backups", status_code=201)
def create_backup(request: Request, db: DB, user: User = Depends(require_perm("backups.manage"))):
    dump: dict[str, list] = {"_meta": [{"created_at": utcnow().isoformat(), "format": 1}]}
    for table in Base.metadata.sorted_tables:
        if table.name == "backups":
            continue
        dump[table.name] = [dict(r._mapping) for r in db.execute(select(table))]
    raw = gzip.compress(json.dumps(dump, default=_json_default).encode())
    key = new_key("backups", "gz")
    get_storage().put(key, raw, "application/gzip")
    b = Backup(file_key=key, size_bytes=len(raw), created_by_id=user.id)
    db.add(b)
    db.flush()
    audit(db, request, user, "BACKUP_CREATE", "backup", b.id, {"size": len(raw)})
    db.commit()
    return {"id": b.id, "size_bytes": b.size_bytes, "created_at": b.created_at}


@router.get("/backups/{backup_id}/download")
def download_backup(backup_id: int, request: Request, db: DB, user: User = Depends(require_perm("backups.manage"))):
    b = get_or_404(db, Backup, backup_id, "Backup")
    audit(db, request, user, "BACKUP_DOWNLOAD", "backup", b.id)
    db.commit()
    return get_storage().response(b.file_key, f"backup-{b.id}.json.gz", "application/gzip", False)


@router.delete("/backups/{backup_id}", status_code=204)
def delete_backup(backup_id: int, request: Request, db: DB, user: User = Depends(require_perm("backups.manage"))):
    b = get_or_404(db, Backup, backup_id, "Backup")
    key = b.file_key
    audit(db, request, user, "BACKUP_DELETE", "backup", b.id)
    db.delete(b)
    db.commit()
    try:
        get_storage().delete(key)
    except Exception:
        pass
