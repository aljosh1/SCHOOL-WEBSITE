import secrets
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.deps import DB, get_or_404, require_perm
from app.core.notify import notify_roles
from app.core.permissions import Role
from app.core.ratelimit import rate_limit
from app.core.security import CODE_ALPHABET, utcnow
from app.models import AdmissionApplication, SchoolClass, User
from app.routers.students import create_student
from app.schemas import ApplicationIn, ApplicationReviewIn, StudentIn
from app.services import access

router = APIRouter(tags=["admissions"])
manage = require_perm("admissions.manage")


def app_dict(a: AdmissionApplication) -> dict:
    return {
        "id": a.id,
        "reference": a.reference,
        "first_name": a.first_name,
        "middle_name": a.middle_name,
        "last_name": a.last_name,
        "full_name": " ".join(p for p in (a.first_name, a.middle_name, a.last_name) if p),
        "date_of_birth": a.date_of_birth,
        "gender": a.gender,
        "class_applied_id": a.class_applied_id,
        "class_applied": a.class_applied.name if a.class_applied else None,
        "previous_school": a.previous_school,
        "address": a.address,
        "state_of_origin": a.state_of_origin,
        "medical_notes": a.medical_notes,
        "guardian_name": a.guardian_name,
        "guardian_relationship": a.guardian_relationship,
        "guardian_phone": a.guardian_phone,
        "guardian_email": a.guardian_email,
        "status": a.status,
        "review_note": a.review_note,
        "reviewed_at": a.reviewed_at,
        "student_id": a.student_id,
        "created_at": a.created_at,
    }


@router.post("/public/applications", status_code=201, dependencies=[Depends(rate_limit("apply", 5, 3600))])
def submit_application(body: ApplicationIn, db: DB):
    if not db.get(SchoolClass, body.class_applied_id):
        raise HTTPException(422, "Selected class does not exist")
    ref = f"APP-{date.today().year}-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
    a = AdmissionApplication(reference=ref, **body.model_dump())
    db.add(a)
    notify_roles(db, [Role.SUPER_ADMIN.value, Role.ADMIN.value], "New admission application",
                 f"{body.first_name} {body.last_name} applied for admission.", "/portal/admissions")
    db.commit()
    return {"reference": ref, "message": "Your application has been received. Keep your reference number."}


@router.get("/applications")
def list_applications(db: DB, _: User = Depends(manage), status: str | None = None, q: str | None = None, page: int = 1, page_size: int = 20):
    page_size = min(max(page_size, 1), 100)
    stmt = select(AdmissionApplication)
    if status:
        stmt = stmt.where(AdmissionApplication.status == status)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(AdmissionApplication.first_name).like(like), func.lower(AdmissionApplication.last_name).like(like),
                              func.lower(AdmissionApplication.reference).like(like), func.lower(AdmissionApplication.guardian_name).like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(
        stmt.options(joinedload(AdmissionApplication.class_applied)).order_by(AdmissionApplication.id.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [app_dict(a) for a in rows], "total": total, "page": page, "page_size": page_size}


@router.put("/applications/{app_id}")
def review_application(app_id: int, body: ApplicationReviewIn, request: Request, db: DB, user: User = Depends(manage)):
    a = get_or_404(db, AdmissionApplication, app_id, "Application")
    if a.student_id:
        raise HTTPException(409, "This applicant has already been admitted")
    a.status, a.review_note = body.status, body.review_note
    a.reviewed_by_id, a.reviewed_at = user.id, utcnow()
    audit(db, request, user, "APPLICATION_REVIEW", "application", a.id, {"status": a.status})
    db.commit()
    return app_dict(a)


@router.post("/applications/{app_id}/admit", status_code=201)
def admit(app_id: int, request: Request, db: DB, user: User = Depends(require_perm("admissions.manage", "students.write")), arm_id: int | None = None):
    a = get_or_404(db, AdmissionApplication, app_id, "Application")
    if a.student_id:
        raise HTTPException(409, "This applicant has already been admitted")
    sess = access.current_session(db)
    body = StudentIn(
        first_name=a.first_name, middle_name=a.middle_name, last_name=a.last_name, date_of_birth=a.date_of_birth, gender=a.gender,
        address=a.address, state_of_origin=a.state_of_origin, medical_notes=a.medical_notes, previous_school=a.previous_school,
        parent_name=a.guardian_name, parent_relationship=a.guardian_relationship, parent_phone=a.guardian_phone,
        parent_email=a.guardian_email, class_id=a.class_applied_id, arm_id=arm_id, session_id=sess.id if sess else None,
    )
    created = create_student(body, request, db, user)
    a.student_id = created["id"]
    a.status = "ADMITTED"
    a.reviewed_by_id, a.reviewed_at = user.id, utcnow()
    audit(db, request, user, "APPLICATION_ADMIT", "application", a.id, {"student_id": a.student_id})
    db.commit()
    return created
