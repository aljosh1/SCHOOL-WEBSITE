import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, has_perm, require_perm
from app.core.permissions import Role
from app.core.storage import get_storage, new_key
from app.core.uploads import process_image
from app.models import AcademicSession, ClassArm, Enrollment, Parent, SchoolClass, Student, User
from app.schemas import PromoteIn, StudentIn
from app.services import access
from app.services.accounts import create_user

router = APIRouter(prefix="/students", tags=["students"])


def class_label(e: Enrollment | None) -> str | None:
    if not e:
        return None
    return e.school_class.name + (f" {e.arm.name}" if e.arm else "")


def student_dict(s: Student, e: Enrollment | None = None, full: bool = True) -> dict:
    d = {
        "id": s.id,
        "student_no": s.student_no,
        "admission_no": s.admission_no,
        "full_name": s.full_name,
        "first_name": s.first_name,
        "middle_name": s.middle_name,
        "last_name": s.last_name,
        "gender": s.gender,
        "status": s.status,
        "photo_url": f"/api/students/{s.id}/photo" if s.photo_key else None,
        "class_id": e.class_id if e else None,
        "arm_id": e.arm_id if e else None,
        "session_id": e.session_id if e else None,
        "class_name": class_label(e),
        "session": e.session.name if e else None,
        "enrollment_id": e.id if e else None,
        "has_login": s.user_id is not None,
    }
    if full:
        p = s.parent
        d |= {
            "date_of_birth": s.date_of_birth,
            "address": s.address,
            "state_of_origin": s.state_of_origin,
            "religion": s.religion,
            "blood_group": s.blood_group,
            "medical_notes": s.medical_notes,
            "previous_school": s.previous_school,
            "admission_date": s.admission_date,
            "emergency_name": s.emergency_name,
            "emergency_phone": s.emergency_phone,
            "emergency_relationship": s.emergency_relationship,
            "parent_name": p.full_name if p else None,
            "parent_relationship": p.relationship_type if p else None,
            "parent_phone": p.phone if p else None,
            "parent_email": p.email if p else None,
            "parent_address": p.address if p else None,
            "parent_occupation": p.occupation if p else None,
            "username": s.user.username if s.user else None,
        }
    return d


def _next_number(db: Session, column, prefix: str) -> str:
    last = db.scalar(select(column).where(column.like(f"{prefix}%")).order_by(column.desc()).limit(1))
    n = int(last.rsplit("-", 1)[-1]) + 1 if last and last.rsplit("-", 1)[-1].isdigit() else 1
    return f"{prefix}{n:04d}"


def _upsert_parent(db: Session, s: Student, d: dict) -> None:
    keys = {"parent_name": "full_name", "parent_relationship": "relationship_type", "parent_phone": "phone",
            "parent_email": "email", "parent_address": "address", "parent_occupation": "occupation"}
    if not any(k in d for k in keys):
        return
    p = s.parent
    if p is None:
        name, phone = d.get("parent_name"), d.get("parent_phone")
        if not name:
            return
        if phone:
            p = db.scalars(select(Parent).where(Parent.phone == phone, func.lower(Parent.full_name) == name.lower())).first()
        if p is None:
            p = Parent(full_name=name)
            db.add(p)
        s.parent = p
    for k, col in keys.items():
        if k in d:
            setattr(p, col, d[k])


def visible_students_query(db: Session, user: User, session_id: int | None):
    """Base (Student, Enrollment) query limited to what the caller may see."""
    sid = session_id
    if sid is None:
        cur = access.current_session(db)
        sid = cur.id if cur else -1
    q = select(Student, Enrollment).outerjoin(
        Enrollment, and_(Enrollment.student_id == Student.id, Enrollment.session_id == sid)
    )
    if user.role == Role.TEACHER.value:
        teacher = access.teacher_for(db, user)
        if not teacher:
            raise HTTPException(403, "No teacher profile")
        q = q.where(access.enrollment_scope_clause(db, teacher, sid))
    elif user.role == Role.STUDENT.value:
        raise HTTPException(403, "You do not have permission to perform this action")
    return q, sid


def _filters(q, search, class_id, arm_id, status):
    if class_id:
        q = q.where(Enrollment.class_id == class_id)
    if arm_id:
        q = q.where(Enrollment.arm_id == arm_id)
    if status:
        q = q.where(Student.status == status)
    if search:
        for term in search.split():
            like = f"%{term.lower()}%"
            q = q.where(
                or_(
                    func.lower(Student.first_name).like(like),
                    func.lower(Student.last_name).like(like),
                    func.lower(func.coalesce(Student.middle_name, "")).like(like),
                    func.lower(Student.student_no).like(like),
                    func.lower(Student.admission_no).like(like),
                )
            )
    return q


@router.get("")
def list_students(
    db: DB,
    user: User = Depends(require_perm("students.read")),
    q: str | None = None,
    class_id: int | None = None,
    arm_id: int | None = None,
    session_id: int | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    page_size = min(max(page_size, 1), 200)
    base, _ = visible_students_query(db, user, session_id)
    base = _filters(base, q, class_id, arm_id, status)
    total = db.scalar(base.order_by(None).with_only_columns(func.count(Student.id), maintain_column_froms=True))
    rows = db.execute(
        base.options(joinedload(Student.parent), joinedload(Student.user))
        .order_by(Student.last_name, Student.first_name)
        .offset((max(page, 1) - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [student_dict(s, e, full=False) for s, e in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/export.csv")
def export_students(
    request: Request,
    db: DB,
    user: User = Depends(require_perm("students.read")),
    q: str | None = None,
    class_id: int | None = None,
    arm_id: int | None = None,
    session_id: int | None = None,
    status: str | None = None,
):
    base, _ = visible_students_query(db, user, session_id)
    rows = db.execute(
        _filters(base, q, class_id, arm_id, status)
        .options(joinedload(Student.parent))
        .order_by(Student.last_name, Student.first_name)
        .limit(5000)
    ).all()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Student ID", "Admission No", "Last Name", "First Name", "Middle Name", "Gender", "Date of Birth", "Class",
                "Session", "Status", "Parent/Guardian", "Parent Phone", "Parent Email", "Address"])

    def safe(v):
        v = "" if v is None else str(v)
        return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v

    for s, e in rows:
        p = s.parent
        w.writerow([safe(x) for x in (s.student_no, s.admission_no, s.last_name, s.first_name, s.middle_name, s.gender,
                    s.date_of_birth, class_label(e), e.session.name if e else "", s.status,
                    p.full_name if p else "", p.phone if p else "", p.email if p else "", s.address)])
    audit(db, request, user, "STUDENT_EXPORT", "student", None, {"rows": len(rows)})
    db.commit()
    return Response(
        out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="students.csv"'},
    )


@router.get("/me")
def my_profile(db: DB, user: CurrentUser):
    s = access.student_for(db, user)
    if not s:
        raise HTTPException(404, "No student profile is linked to this account")
    e = access.current_enrollment(db, s.id) or access.latest_enrollment(db, s.id)
    return student_dict(s, e)


def _authorize_student(db: Session, user: User, student_id: int) -> None:
    if user.role == Role.STUDENT.value:
        s = access.student_for(db, user)
        if not s or s.id != student_id:
            raise HTTPException(404, "Student not found")
    elif user.role == Role.TEACHER.value:
        t = access.teacher_for(db, user)
        if not t or not access.teacher_can_see_student(db, t, student_id):
            raise HTTPException(404, "Student not found")
    elif not has_perm(db, user, "students.read"):
        raise HTTPException(403, "You do not have permission to perform this action")


@router.get("/{student_id}")
def get_student(student_id: int, db: DB, user: CurrentUser):
    _authorize_student(db, user, student_id)
    s = get_or_404(db, Student, student_id, "Student")
    e = access.current_enrollment(db, s.id) or access.latest_enrollment(db, s.id)
    history = [
        {"session": x.session.name, "class_name": class_label(x), "status": x.status}
        for x in sorted(s.enrollments, key=lambda x: x.session.name, reverse=True)
    ]
    d = student_dict(s, e)
    if user.role == Role.STUDENT.value:
        d.pop("medical_notes", None)
    return d | {"history": history}


@router.post("", status_code=201)
def create_student(body: StudentIn, request: Request, db: DB, user: User = Depends(require_perm("students.write"))):
    d = body.model_dump(exclude_unset=True)
    sess = db.get(AcademicSession, body.session_id) if body.session_id else access.current_session(db)
    if body.class_id:
        if not sess:
            raise HTTPException(422, "Create an academic session first")
        _check_class_arm(db, body.class_id, body.arm_id)
    year = (sess.name[:4] if sess else str(date.today().year))
    s = None
    for _ in range(3):
        try:
            with db.begin_nested():
                adm = body.admission_no or _next_number(db, Student.admission_no, f"ADM-{year}-")
                if body.admission_no and db.scalars(select(Student.id).where(func.lower(Student.admission_no) == adm.lower())).first():
                    raise HTTPException(409, "That admission number is already in use")
                s = Student(
                    student_no=_next_number(db, Student.student_no, f"STU-{year}-"),
                    admission_no=adm,
                    **{k: v for k, v in d.items() if k in _STUDENT_FIELDS},
                )
                s.status = d.get("status") or "ACTIVE"
                s.admission_date = d.get("admission_date") or date.today()
                db.add(s)
                db.flush()
            break
        except IntegrityError:
            s = None
    if s is None:
        raise HTTPException(409, "Could not allocate a student number. Please try again.")
    _upsert_parent(db, s, d)
    e = None
    if body.class_id and sess:
        e = Enrollment(student_id=s.id, session_id=sess.id, class_id=body.class_id, arm_id=body.arm_id)
        db.add(e)
    user_acct, temp = create_user(db, username=s.student_no, full_name=s.full_name, role=Role.STUDENT.value)
    s.user_id = user_acct.id
    audit(db, request, user, "STUDENT_CREATE", "student", s.id, {"student_no": s.student_no})
    db.commit()
    return student_dict(s, e) | {"credentials": {"username": user_acct.username, "temporary_password": temp}}


_STUDENT_FIELDS = {
    "first_name", "middle_name", "last_name", "date_of_birth", "gender", "address", "state_of_origin", "religion",
    "blood_group", "medical_notes", "previous_school", "emergency_name", "emergency_phone", "emergency_relationship",
}


def _check_class_arm(db: Session, class_id: int, arm_id: int | None) -> None:
    if not db.get(SchoolClass, class_id):
        raise HTTPException(422, "Selected class does not exist")
    if arm_id:
        arm = db.get(ClassArm, arm_id)
        if not arm or arm.class_id != class_id:
            raise HTTPException(422, "Selected arm does not belong to that class")


@router.put("/{student_id}")
def update_student(student_id: int, body: StudentIn, request: Request, db: DB, user: User = Depends(require_perm("students.write"))):
    s = get_or_404(db, Student, student_id, "Student")
    d = body.model_dump(exclude_unset=True)
    if "admission_no" in d and d["admission_no"] and d["admission_no"] != s.admission_no:
        if db.scalars(select(Student.id).where(func.lower(Student.admission_no) == d["admission_no"].lower())).first():
            raise HTTPException(409, "That admission number is already in use")
        s.admission_no = d["admission_no"]
    for k in _STUDENT_FIELDS | {"admission_date"}:
        if k in d:
            setattr(s, k, d[k])
    if "status" in d and d["status"]:
        s.status = d["status"]
        if s.user:
            s.user.is_active = d["status"] == "ACTIVE" or d["status"] == "GRADUATED"
    _upsert_parent(db, s, d)
    if s.user:
        s.user.full_name = s.full_name
    e = access.current_enrollment(db, s.id, body.session_id)
    if body.class_id:
        sess_id = body.session_id or (access.current_session(db).id if access.current_session(db) else None)
        if sess_id is None:
            raise HTTPException(422, "Create an academic session first")
        _check_class_arm(db, body.class_id, body.arm_id)
        if e:
            e.class_id, e.arm_id = body.class_id, body.arm_id
        else:
            e = Enrollment(student_id=s.id, session_id=sess_id, class_id=body.class_id, arm_id=body.arm_id)
            db.add(e)
    audit(db, request, user, "STUDENT_UPDATE", "student", s.id, {"fields": sorted(d)})
    db.commit()
    return student_dict(s, e or access.latest_enrollment(db, s.id))


@router.post("/{student_id}/photo")
async def upload_photo(student_id: int, file: UploadFile, request: Request, db: DB, user: User = Depends(require_perm("students.write"))):
    s = get_or_404(db, Student, student_id, "Student")
    data, ext, mime = await process_image(file, 600, max_mb=5)
    storage = get_storage()
    key = new_key("photos", ext)
    storage.put(key, data, mime)
    old, s.photo_key = s.photo_key, key
    audit(db, request, user, "STUDENT_PHOTO_UPLOAD", "student", s.id)
    db.commit()
    if old:
        try:
            storage.delete(old)
        except Exception:
            pass
    return {"photo_url": f"/api/students/{s.id}/photo"}


@router.get("/{student_id}/photo")
def get_photo(student_id: int, db: DB, user: CurrentUser):
    _authorize_student(db, user, student_id)
    s = get_or_404(db, Student, student_id, "Student")
    if not s.photo_key:
        raise HTTPException(404, "No photo")
    return get_storage().response(s.photo_key, f"{s.student_no}.jpg", "image/jpeg", inline=True)


@router.post("/{student_id}/{action}")
def set_status(student_id: int, action: str, request: Request, db: DB, user: User = Depends(require_perm("students.write"))):
    if action not in ("deactivate", "activate"):
        raise HTTPException(404, "Not found")
    s = get_or_404(db, Student, student_id, "Student")
    s.status = "INACTIVE" if action == "deactivate" else "ACTIVE"
    if s.user:
        s.user.is_active = action == "activate"
    audit(db, request, user, "STUDENT_DEACTIVATE" if action == "deactivate" else "STUDENT_ACTIVATE", "student", s.id)
    db.commit()
    return {"id": s.id, "status": s.status}


@router.post("/promote")
def promote(body: PromoteIn, request: Request, db: DB, user: User = Depends(require_perm("students.write"))):
    target = get_or_404(db, AcademicSession, body.to_session_id, "Session")
    if not body.graduate:
        if not body.to_class_id:
            raise HTTPException(422, "Choose the class to promote students to")
        _check_class_arm(db, body.to_class_id, body.to_arm_id)
    promoted, skipped = 0, []
    for sid in body.student_ids:
        s = db.get(Student, sid)
        if not s:
            continue
        if db.scalars(select(Enrollment.id).where(Enrollment.student_id == sid, Enrollment.session_id == target.id)).first() and not body.graduate:
            skipped.append({"id": sid, "reason": "Already enrolled in the target session"})
            continue
        prev = access.latest_enrollment(db, sid)
        if body.graduate:
            s.status = "GRADUATED"
            if prev:
                prev.status = "GRADUATED"
        else:
            db.add(Enrollment(student_id=sid, session_id=target.id, class_id=body.to_class_id, arm_id=body.to_arm_id))
            if prev:
                prev.status = "PROMOTED"
        promoted += 1
    audit(db, request, user, "STUDENT_PROMOTE", "student", None,
          {"count": promoted, "to_session": target.name, "to_class_id": body.to_class_id, "graduate": body.graduate})
    db.commit()
    return {"promoted": promoted, "skipped": skipped}
