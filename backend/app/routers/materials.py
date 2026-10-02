from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, has_perm, require_perm
from app.core.notify import notify
from app.core.permissions import Role
from app.core.storage import get_storage, new_key
from app.core.uploads import INLINE_OK_MIMES, MATERIAL_KINDS, validate_material
from app.models import (
    AcademicSession,
    Enrollment,
    LearningMaterial,
    SchoolClass,
    Student,
    Subject,
    Teacher,
    Term,
    User,
)
from app.schemas import MaterialUpdate
from app.services import access

router = APIRouter(prefix="/materials", tags=["materials"])
LABEL_KINDS = {"PAST_QUESTION", "ASSIGNMENT", "NOTE"}


def material_dict(m: LearningMaterial) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "description": m.description,
        "kind": m.kind,
        "subject_id": m.subject_id,
        "subject": m.subject.name,
        "class_id": m.class_id,
        "class_name": m.school_class.name,
        "teacher": m.teacher.user.full_name if m.teacher else None,
        "session": m.session.name,
        "session_id": m.session_id,
        "term": m.term.name,
        "term_id": m.term_id,
        "file_name": m.file_name,
        "mime_type": m.mime_type.split(";")[0] if m.mime_type else None,
        "size_bytes": m.size_bytes,
        "has_file": bool(m.file_key),
        "text_content": m.text_content,
        "visibility": m.visibility,
        "uploaded_by_id": m.uploaded_by_id,
        "created_at": m.created_at,
    }


_OPTS = (
    joinedload(LearningMaterial.subject),
    joinedload(LearningMaterial.school_class),
    joinedload(LearningMaterial.session),
    joinedload(LearningMaterial.term),
    joinedload(LearningMaterial.teacher).joinedload(Teacher.user),
)


def _student_class_id(db: Session, user: User) -> int | None:
    s = access.student_for(db, user)
    if not s:
        return None
    e = access.current_enrollment(db, s.id) or access.latest_enrollment(db, s.id)
    return e.class_id if e else None


def _teacher_pairs(db: Session, user: User, session_id: int | None = None) -> set[tuple[int, int]]:
    t = access.teacher_for(db, user)
    if not t:
        return set()
    sess = session_id or (access.current_session(db).id if access.current_session(db) else None)
    return {(a.class_id, a.subject_id) for a in access.assignments_for(db, t.id, sess)} if sess else set()


def can_view(db: Session, user: User, m: LearningMaterial) -> bool:
    if user.role == Role.STUDENT.value:
        return m.visibility == "PUBLISHED" and m.class_id == _student_class_id(db, user)
    if user.role == Role.TEACHER.value:
        return m.uploaded_by_id == user.id or (
            m.visibility == "PUBLISHED" and (m.class_id, m.subject_id) in _teacher_pairs(db, user, m.session_id)
        )
    return has_perm(db, user, "materials.read")


def can_manage(db: Session, user: User, m: LearningMaterial) -> bool:
    if user.role == Role.TEACHER.value:
        return m.uploaded_by_id == user.id
    return has_perm(db, user, "materials.write")


@router.get("")
def list_materials(
    db: DB,
    user: User = Depends(require_perm("materials.read")),
    q: str | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    term_id: int | None = None,
    session_id: int | None = None,
    kind: str | None = None,
    visibility: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    page_size = min(max(page_size, 1), 100)
    stmt = select(LearningMaterial)
    if user.role == Role.STUDENT.value:
        cid = _student_class_id(db, user)
        stmt = stmt.where(LearningMaterial.visibility == "PUBLISHED", LearningMaterial.class_id == (cid or -1))
        class_id = None
    elif user.role == Role.TEACHER.value:
        pairs = _teacher_pairs(db, user)
        scope = [LearningMaterial.uploaded_by_id == user.id]
        for cid, sid in pairs:
            scope.append((LearningMaterial.class_id == cid) & (LearningMaterial.subject_id == sid) & (LearningMaterial.visibility == "PUBLISHED"))
        stmt = stmt.where(or_(*scope))
    for col, val in ((LearningMaterial.class_id, class_id), (LearningMaterial.subject_id, subject_id), (LearningMaterial.term_id, term_id),
                     (LearningMaterial.session_id, session_id), (LearningMaterial.kind, kind)):
        if val:
            stmt = stmt.where(col == val)
    if visibility and user.role != Role.STUDENT.value:
        stmt = stmt.where(LearningMaterial.visibility == visibility)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(LearningMaterial.title).like(like), func.lower(func.coalesce(LearningMaterial.description, "")).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = db.scalars(
        stmt.options(*_OPTS).order_by(LearningMaterial.created_at.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [material_dict(m) | {"can_manage": can_manage(db, user, m)} for m in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/subjects")
def subject_tiles(db: DB, user: User = Depends(require_perm("materials.read")), class_id: int | None = None):
    """Subjects with the number of published materials, used for the student dashboard tiles."""
    cid = _student_class_id(db, user) if user.role == Role.STUDENT.value else class_id
    q = (
        select(Subject.id, Subject.name, func.count(LearningMaterial.id))
        .outerjoin(
            LearningMaterial,
            (LearningMaterial.subject_id == Subject.id) & (LearningMaterial.visibility == "PUBLISHED") & (LearningMaterial.class_id == (cid or -1)),
        )
        .where(Subject.is_active.is_(True))
        .group_by(Subject.id, Subject.name)
        .order_by(Subject.name)
    )
    return [{"subject_id": i, "subject": n, "count": c} for i, n, c in db.execute(q)]


@router.get("/{material_id}")
def get_material(material_id: int, db: DB, user: CurrentUser):
    m = db.scalars(select(LearningMaterial).where(LearningMaterial.id == material_id).options(*_OPTS)).unique().first()
    if not m or not can_view(db, user, m):
        raise HTTPException(404, "Material not found")
    return material_dict(m) | {"can_manage": can_manage(db, user, m)}


def _notify_students(db: Session, m: LearningMaterial) -> None:
    ids = db.scalars(
        select(Student.user_id)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(Enrollment.session_id == m.session_id, Enrollment.class_id == m.class_id, Student.status == "ACTIVE", Student.user_id.is_not(None))
    ).all()
    subject = db.get(Subject, m.subject_id)
    notify(db, ids, "New learning material", f"New {subject.name} learning material uploaded: {m.title}", "/portal/materials")


@router.post("", status_code=201)
async def upload_material(
    request: Request,
    db: DB,
    user: User = Depends(require_perm("materials.write")),
    title: Annotated[str, Form(min_length=2, max_length=200)] = "",
    subject_id: Annotated[int, Form()] = 0,
    class_id: Annotated[int, Form()] = 0,
    description: Annotated[str | None, Form(max_length=5000)] = None,
    kind: Annotated[str | None, Form()] = None,
    session_id: Annotated[int | None, Form()] = None,
    term_id: Annotated[int | None, Form()] = None,
    visibility: Annotated[str, Form(pattern="^(DRAFT|PUBLISHED)$")] = "DRAFT",
    text_content: Annotated[str | None, Form(max_length=50000)] = None,
    file: UploadFile | None = File(None),
):
    if not title.strip():
        raise HTTPException(422, "Title is required")
    get_or_404(db, Subject, subject_id, "Subject")
    get_or_404(db, SchoolClass, class_id, "Class")
    sess = db.get(AcademicSession, session_id) if session_id else access.current_session(db)
    if not sess:
        raise HTTPException(422, "No academic session is set up")
    term = db.get(Term, term_id) if term_id else access.current_term(db, sess.id)
    if not term or term.session_id != sess.id:
        raise HTTPException(422, "Select a valid term for this session")
    teacher = access.teacher_for(db, user)
    if user.role == Role.TEACHER.value and (class_id, subject_id) not in _teacher_pairs(db, user, sess.id):
        raise HTTPException(403, "You are not assigned to this class and subject")
    if kind and kind not in MATERIAL_KINDS:
        raise HTTPException(422, "Unknown material type")
    has_file = file is not None and bool(file.filename)
    if not has_file and not (text_content and text_content.strip()):
        raise HTTPException(422, "Attach a file or write the material text")

    m = LearningMaterial(
        title=title.strip(), description=description, subject_id=subject_id, class_id=class_id, session_id=sess.id, term_id=term.id,
        teacher_id=teacher.id if teacher else None, uploaded_by_id=user.id, visibility=visibility, text_content=text_content,
    )
    storage = get_storage()
    key = None
    if has_file:
        data, ext, detected_kind, mime, safe_name = await validate_material(file)
        key = new_key("materials", ext)
        storage.put(key, data, mime)
        m.file_key, m.file_name, m.mime_type, m.size_bytes = key, safe_name, mime, len(data)
        m.kind = kind if kind in LABEL_KINDS else detected_kind
    else:
        m.kind = kind if kind in LABEL_KINDS else "TEXT"
    db.add(m)
    try:
        db.flush()
        audit(db, request, user, "MATERIAL_UPLOAD", "material", m.id, {"title": m.title, "file": m.file_name, "class_id": class_id, "subject_id": subject_id})
        if visibility == "PUBLISHED":
            _notify_students(db, m)
        db.commit()
    except Exception:
        db.rollback()
        if key:
            storage.delete(key)
        raise
    return material_dict(db.scalars(select(LearningMaterial).where(LearningMaterial.id == m.id).options(*_OPTS)).unique().one())


@router.put("/{material_id}")
def update_material(material_id: int, body: MaterialUpdate, request: Request, db: DB, user: User = Depends(require_perm("materials.write"))):
    m = get_or_404(db, LearningMaterial, material_id, "Material")
    if not can_manage(db, user, m):
        raise HTTPException(403, "You can only edit materials you uploaded")
    d = body.model_dump(exclude_unset=True)
    was_published = m.visibility == "PUBLISHED"
    for k, v in d.items():
        if k == "title" and not v:
            continue
        setattr(m, k, v)
    if m.visibility == "PUBLISHED" and not was_published:
        _notify_students(db, m)
    audit(db, request, user, "MATERIAL_UPDATE", "material", m.id, {"fields": sorted(d)})
    db.commit()
    return material_dict(db.scalars(select(LearningMaterial).where(LearningMaterial.id == m.id).options(*_OPTS)).unique().one())


@router.delete("/{material_id}", status_code=204)
def delete_material(material_id: int, request: Request, db: DB, user: User = Depends(require_perm("materials.write"))):
    m = get_or_404(db, LearningMaterial, material_id, "Material")
    if not can_manage(db, user, m):
        raise HTTPException(403, "You can only delete materials you uploaded")
    key = m.file_key
    audit(db, request, user, "MATERIAL_DELETE", "material", m.id, {"title": m.title, "file": m.file_name})
    db.delete(m)
    db.commit()
    if key:
        try:
            get_storage().delete(key)
        except Exception:
            pass


@router.get("/{material_id}/download")
def download_material(material_id: int, db: DB, user: CurrentUser, inline: bool = False):
    m = get_or_404(db, LearningMaterial, material_id, "Material")
    if not can_view(db, user, m) or not m.file_key:
        raise HTTPException(404, "Material not found")
    mime = m.mime_type or "application/octet-stream"
    show_inline = inline and mime.startswith(INLINE_OK_MIMES)
    return get_storage().response(m.file_key, m.file_name or "material", mime, show_inline)
