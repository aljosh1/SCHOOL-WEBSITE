import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, require_perm
from app.core.permissions import Role
from app.models import (
    ClassArm,
    Enrollment,
    LearningMaterial,
    Notification,
    Result,
    SchoolClass,
    Subject,
    Teacher,
    TeachingAssignment,
    User,
)
from app.schemas import AssignmentsIn, TeacherIn
from app.services import access
from app.services.accounts import create_user

router = APIRouter(prefix="/teachers", tags=["teachers"])


def teacher_dict(t: Teacher) -> dict:
    u = t.user
    return {
        "id": t.id,
        "user_id": u.id,
        "full_name": u.full_name,
        "username": u.username,
        "email": u.email,
        "phone": u.phone,
        "is_active": u.is_active,
        "staff_no": t.staff_no,
        "qualification": t.qualification,
        "bio": t.bio,
        "show_on_website": t.show_on_website,
        "public_title": t.public_title,
    }


def assignment_dict(a: TeachingAssignment) -> dict:
    return {
        "id": a.id,
        "session_id": a.session_id,
        "class_id": a.class_id,
        "class_name": a.school_class.name,
        "arm_id": a.arm_id,
        "arm_name": a.arm.name if a.arm else "All arms",
        "subject_id": a.subject_id,
        "subject": a.subject.name,
    }


def _slug_username(name: str, db) -> str:
    base = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".") or "teacher"
    cand, i = base, 1
    while db.scalars(select(User.id).where(func.lower(User.username) == cand)).first():
        i += 1
        cand = f"{base}{i}"
    return cand


@router.get("")
def list_teachers(db: DB, _: User = Depends(require_perm("teachers.read")), q: str | None = None, page: int = 1, page_size: int = 50):
    page_size = min(max(page_size, 1), 200)
    stmt = select(Teacher).join(User, User.id == Teacher.user_id)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(Teacher.staff_no).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Teacher.id).subquery()))
    rows = db.scalars(
        stmt.options(joinedload(Teacher.user)).order_by(User.full_name).offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [teacher_dict(t) for t in rows], "total": total, "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_teacher(body: TeacherIn, request: Request, db: DB, user: User = Depends(require_perm("teachers.write", "users.manage"))):
    staff_no = body.staff_no
    if staff_no:
        if db.scalars(select(Teacher.id).where(func.lower(Teacher.staff_no) == staff_no.lower())).first():
            raise HTTPException(409, "That staff number is already in use")
    else:
        last = db.scalar(select(Teacher.staff_no).where(Teacher.staff_no.like("TCH-%")).order_by(Teacher.staff_no.desc()).limit(1))
        n = int(last.split("-")[-1]) + 1 if last and last.split("-")[-1].isdigit() else 1
        staff_no = f"TCH-{n:04d}"
    acct, temp = create_user(
        db,
        username=body.username or _slug_username(body.full_name, db),
        full_name=body.full_name,
        role=Role.TEACHER.value,
        email=body.email,
        phone=body.phone,
    )
    t = Teacher(
        user_id=acct.id,
        staff_no=staff_no,
        qualification=body.qualification,
        bio=body.bio,
        show_on_website=body.show_on_website,
        public_title=body.public_title,
    )
    db.add(t)
    db.flush()
    audit(db, request, user, "TEACHER_CREATE", "teacher", t.id, {"username": acct.username})
    db.commit()
    return teacher_dict(t) | {"credentials": {"username": acct.username, "temporary_password": temp}}


@router.get("/me/overview")
def my_overview(db: DB, user: CurrentUser):
    t = access.teacher_for(db, user)
    if not t:
        raise HTTPException(403, "No teacher profile")
    sess = access.current_session(db)
    term = access.current_term(db, sess.id if sess else None)
    items = access.assignments_for(db, t.id, sess.id) if sess else []
    students = 0
    if sess:
        students = db.scalar(
            select(func.count(func.distinct(Enrollment.student_id))).where(
                Enrollment.session_id == sess.id, access.enrollment_scope_clause(db, t, sess.id)
            )
        )
    status_counts = {"DRAFT": 0, "SUBMITTED": 0, "APPROVED": 0, "PUBLISHED": 0}
    if sess and term and items:
        conds = [
            and_(Enrollment.class_id == a.class_id, Result.subject_id == a.subject_id, *( [Enrollment.arm_id == a.arm_id] if a.arm_id else []))
            for a in items
        ]
        rows = db.execute(
            select(Result.status, func.count())
            .join(Enrollment, Enrollment.id == Result.enrollment_id)
            .where(Enrollment.session_id == sess.id, Result.term_id == term.id, or_(*conds))
            .group_by(Result.status)
        ).all()
        status_counts.update({k: v for k, v in rows})
    # expected = students x subjects without any result yet
    pending_entry = 0
    if sess and term:
        for a in items:
            q = select(func.count()).select_from(Enrollment).where(
                Enrollment.session_id == sess.id, Enrollment.class_id == a.class_id, Enrollment.status == "ACTIVE"
            )
            if a.arm_id:
                q = q.where(Enrollment.arm_id == a.arm_id)
            enrolled = db.scalar(q)
            r = select(func.count()).select_from(Result).join(Enrollment, Enrollment.id == Result.enrollment_id).where(
                Enrollment.session_id == sess.id, Enrollment.class_id == a.class_id, Result.subject_id == a.subject_id, Result.term_id == term.id
            )
            if a.arm_id:
                r = r.where(Enrollment.arm_id == a.arm_id)
            pending_entry += max(enrolled - db.scalar(r), 0)
    recent = db.scalars(
        select(LearningMaterial).where(LearningMaterial.uploaded_by_id == user.id).order_by(LearningMaterial.created_at.desc()).limit(5)
    ).all()
    return {
        "teacher": teacher_dict(t),
        "session": sess.name if sess else None,
        "term": term.name if term else None,
        "term_id": term.id if term else None,
        "assignments": [assignment_dict(a) for a in items],
        "student_count": students,
        "results": {**status_counts, "NOT_STARTED": pending_entry},
        "material_count": db.scalar(select(func.count()).select_from(LearningMaterial).where(LearningMaterial.uploaded_by_id == user.id)),
        "recent_materials": [
            {"id": m.id, "title": m.title, "kind": m.kind, "created_at": m.created_at, "visibility": m.visibility} for m in recent
        ],
        "unread_notifications": db.scalar(
            select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))
        ),
    }


@router.get("/{teacher_id}")
def get_teacher(teacher_id: int, db: DB, user: User = Depends(require_perm("teachers.read"))):
    t = get_or_404(db, Teacher, teacher_id, "Teacher")
    if user.role == Role.TEACHER.value and t.user_id != user.id:
        # Teachers may see colleagues' basic info only
        d = teacher_dict(t)
        return {k: d[k] for k in ("id", "full_name", "staff_no", "public_title")}
    return teacher_dict(t)


@router.put("/{teacher_id}")
def update_teacher(teacher_id: int, body: TeacherIn, request: Request, db: DB, user: User = Depends(require_perm("teachers.write"))):
    t = get_or_404(db, Teacher, teacher_id, "Teacher")
    d = body.model_dump(exclude_unset=True)
    if d.get("email"):
        clash = db.scalars(select(User.id).where(func.lower(User.email) == d["email"].lower(), User.id != t.user_id)).first()
        if clash:
            raise HTTPException(409, "That email is already in use")
        t.user.email = d["email"].lower()
    t.user.full_name = d.get("full_name", t.user.full_name)
    if "phone" in d:
        t.user.phone = d["phone"]
    if d.get("is_active") is not None:
        t.user.is_active = d["is_active"]
    for k in ("qualification", "bio", "show_on_website", "public_title"):
        if k in d:
            setattr(t, k, d[k])
    if d.get("staff_no") and d["staff_no"] != t.staff_no:
        if db.scalars(select(Teacher.id).where(func.lower(Teacher.staff_no) == d["staff_no"].lower())).first():
            raise HTTPException(409, "That staff number is already in use")
        t.staff_no = d["staff_no"]
    audit(db, request, user, "TEACHER_UPDATE", "teacher", t.id, {"fields": sorted(d)})
    db.commit()
    return teacher_dict(t)


@router.get("/{teacher_id}/assignments")
def get_assignments(teacher_id: int, db: DB, user: CurrentUser, session_id: int | None = None):
    t = get_or_404(db, Teacher, teacher_id, "Teacher")
    if user.role == Role.TEACHER.value and t.user_id != user.id:
        raise HTTPException(403, "You can only view your own assignments")
    if user.role == Role.STUDENT.value:
        raise HTTPException(403, "You do not have permission to perform this action")
    sess_id = session_id or (access.current_session(db).id if access.current_session(db) else None)
    rows = (
        db.scalars(
            select(TeachingAssignment)
            .where(TeachingAssignment.teacher_id == t.id, TeachingAssignment.session_id == sess_id)
            .options(joinedload(TeachingAssignment.school_class), joinedload(TeachingAssignment.arm), joinedload(TeachingAssignment.subject))
        ).unique()
        if sess_id
        else []
    )
    return [assignment_dict(a) for a in rows]


@router.put("/{teacher_id}/assignments")
def put_assignments(teacher_id: int, body: AssignmentsIn, request: Request, db: DB, user: User = Depends(require_perm("teachers.write"))):
    t = get_or_404(db, Teacher, teacher_id, "Teacher")
    seen = set()
    for it in body.items:
        key = (it.class_id, it.arm_id, it.subject_id)
        if key in seen:
            raise HTTPException(422, "Duplicate assignment in request")
        seen.add(key)
        if not db.get(SchoolClass, it.class_id) or not db.get(Subject, it.subject_id):
            raise HTTPException(422, "Unknown class or subject")
        if it.arm_id:
            arm = db.get(ClassArm, it.arm_id)
            if not arm or arm.class_id != it.class_id:
                raise HTTPException(422, "Arm does not belong to that class")
    for old in db.scalars(select(TeachingAssignment).where(TeachingAssignment.teacher_id == t.id, TeachingAssignment.session_id == body.session_id)):
        db.delete(old)
    db.flush()
    for it in body.items:
        db.add(TeachingAssignment(teacher_id=t.id, session_id=body.session_id, **it.model_dump()))
    audit(db, request, user, "TEACHER_ASSIGN", "teacher", t.id, {"count": len(body.items), "session_id": body.session_id})
    db.commit()
    return get_assignments(teacher_id, db, user, body.session_id)
