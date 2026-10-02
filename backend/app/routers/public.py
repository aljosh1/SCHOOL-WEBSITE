from datetime import timedelta
import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func, select, update
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.config import get_settings
from app.core.deps import DB
from app.core.ratelimit import client_ip, rate_limit
from app.core.security import create_scoped_token, decode_token, hash_code, normalize_code, utcnow
from app.core.storage import get_storage
from app.models import (
    AcademicSession,
    Enrollment,
    ReportCard,
    ResultAccessCode,
    ResultAccessLog,
    SchoolClass,
    Student,
    Subject,
    Teacher,
    Term,
    User,
)
from app.routers.results import pdf_response, report_pdf_bytes
from app.routers.settings import public_school
from app.schemas import ResultCheckIn
from app.services.pdf import qr_png
from app.services import access
from app.services import results as svc

router = APIRouter(tags=["public"])
settings = get_settings()

GENERIC_ERROR = "We could not verify those details. Check your Student ID, PIN, session and term and try again."
THROTTLED = "Too many unsuccessful attempts. Please wait a few minutes and try again."
# Reasons that do not indicate guessing (valid ID + valid PIN were both supplied).
NON_FAILURE_REASONS = {"NOT_AVAILABLE", "OK"}


@router.get("/public/sessions")
def public_sessions(db: DB):
    rows = db.scalars(select(AcademicSession).options(joinedload(AcademicSession.terms)).order_by(AcademicSession.name.desc())).unique()
    return [
        {"id": s.id, "name": s.name, "is_current": s.is_current, "terms": [{"id": t.id, "name": t.name, "is_current": t.is_current} for t in s.terms]}
        for s in rows
    ]


@router.get("/public/classes")
def public_classes(db: DB):
    return [{"id": c.id, "name": c.name} for c in db.scalars(select(SchoolClass).order_by(SchoolClass.level_order, SchoolClass.name))]


@router.get("/public/stats")
def public_stats(db: DB):
    return {
        "students": db.scalar(select(func.count()).select_from(Student).where(Student.status == "ACTIVE")),
        "teachers": db.scalar(select(func.count()).select_from(Teacher).join(User, User.id == Teacher.user_id).where(User.is_active.is_(True))),
        "classes": db.scalar(select(func.count()).select_from(SchoolClass)),
        "subjects": db.scalar(select(func.count()).select_from(Subject).where(Subject.is_active.is_(True))),
    }


@router.get("/public/staff")
def public_staff(db: DB):
    rows = db.scalars(
        select(Teacher).join(User, User.id == Teacher.user_id).where(Teacher.show_on_website.is_(True), User.is_active.is_(True)).options(joinedload(Teacher.user)).order_by(User.full_name)
    ).unique()
    return [{"name": t.user.full_name, "title": t.public_title or "Teacher", "qualification": t.qualification} for t in rows]


def _log(db, request: Request, *, ref: str, success: bool, reason: str, code: ResultAccessCode | None = None,
         student: Student | None = None, card: ReportCard | None = None) -> None:
    db.add(
        ResultAccessLog(
            code_id=code.id if code else None,
            student_id=student.id if student else None,
            report_card_id=card.id if card else None,
            ref=ref[:60],
            success=success,
            reason=reason,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent", "")[:255],
        )
    )


def _throttled(db, ip: str, ref: str) -> bool:
    since = utcnow() - timedelta(minutes=settings.result_check_window_minutes)
    base = select(func.count(ResultAccessLog.id)).where(
        ResultAccessLog.created_at >= since, ResultAccessLog.success.is_(False), ResultAccessLog.reason.notin_(NON_FAILURE_REASONS)
    )
    if db.scalar(base.where(ResultAccessLog.ip == ip)) >= settings.result_check_ip_limit:
        return True
    return db.scalar(base.where(ResultAccessLog.ref == ref)) >= settings.result_check_student_limit


def _photo_data_uri(student: Student) -> str | None:
    if not student.photo_key:
        return None
    try:
        return "data:image/jpeg;base64," + base64.b64encode(get_storage().read(student.photo_key)).decode()
    except Exception:
        return None


def _fail(db, request, ref, reason, code=None, student=None):
    _log(db, request, ref=ref, success=False, reason=reason, code=code, student=student)
    db.commit()
    raise HTTPException(400, GENERIC_ERROR)


@router.post("/results/check", dependencies=[Depends(rate_limit("check", 60, 60))])
def check_result(body: ResultCheckIn, request: Request, db: DB):
    ip = client_ip(request)
    ref = body.student_ref.strip().upper()
    if _throttled(db, ip, ref):
        _log(db, request, ref=ref, success=False, reason="THROTTLED")
        db.commit()
        raise HTTPException(429, THROTTLED)

    student = db.scalars(
        select(Student).where((func.upper(Student.student_no) == ref) | (func.upper(Student.admission_no) == ref))
    ).first()
    code = db.scalars(select(ResultAccessCode).where(ResultAccessCode.code_hash == hash_code(body.code))).first()
    if not code or len(normalize_code(body.code)) < 8:
        _fail(db, request, ref, "BAD_CODE", None, student)
    if not student:
        _fail(db, request, ref, "BAD_STUDENT", code)

    now = utcnow()
    if not code.is_active:
        _fail(db, request, ref, "DISABLED", code, student)
    if code.expires_at and code.expires_at < now:
        _fail(db, request, ref, "EXPIRED", code, student)
    if code.use_count >= code.max_uses:
        _fail(db, request, ref, "EXHAUSTED", code, student)
    if code.session_id != body.session_id or (code.term_id and code.term_id != body.term_id):
        _fail(db, request, ref, "SCOPE_MISMATCH", code, student)
    if code.student_id and code.student_id != student.id:
        _fail(db, request, ref, "STUDENT_MISMATCH", code, student)

    term = db.get(Term, body.term_id)
    if not term or term.session_id != body.session_id:
        _fail(db, request, ref, "BAD_TERM", code, student)
    enrollment = db.scalars(select(Enrollment).where(Enrollment.student_id == student.id, Enrollment.session_id == body.session_id)).first()
    school = access.get_school(db)
    report = svc.build_report(db, enrollment, term.id, school) if enrollment else None
    if not report:
        _log(db, request, ref=ref, success=False, reason="NOT_AVAILABLE", code=code, student=student)
        db.commit()
        raise HTTPException(404, "Your result for this term is not available yet. Please check again later.")

    # Atomic consume so concurrent requests cannot exceed the limit.
    res = db.execute(
        update(ResultAccessCode)
        .where(ResultAccessCode.id == code.id, ResultAccessCode.use_count < ResultAccessCode.max_uses, ResultAccessCode.is_active.is_(True))
        .values(
            use_count=ResultAccessCode.use_count + 1,
            first_used_at=func.coalesce(ResultAccessCode.first_used_at, now),
            last_used_at=now,
            student_id=func.coalesce(ResultAccessCode.student_id, student.id),
        )
    )
    if res.rowcount != 1:
        db.rollback()
        raise HTTPException(400, GENERIC_ERROR)
    card = db.get(ReportCard, report["card_id"])
    _log(db, request, ref=ref, success=True, reason="OK", code=code, student=student, card=card)
    audit(db, request, None, "RESULT_ACCESS", "report_card", card.id if card else None,
          {"serial": code.serial, "student_id": student.id, "term_id": term.id})
    db.commit()
    db.refresh(code)

    report["student"]["photo"] = _photo_data_uri(student)
    token = create_scoped_token("result_pdf", {"card": card.id, "code": code.id}, minutes=30)
    return {
        "report": report,
        "school": public_school(db, school),
        "pdf_token": token,
        "uses_remaining": max(code.max_uses - code.use_count, 0),
    }


@router.get("/results/check/pdf", dependencies=[Depends(rate_limit("checkpdf", 30, 60))])
def check_pdf(token: str, request: Request, db: DB):
    data = decode_token(token, "result_pdf")
    if not data:
        raise HTTPException(400, "This download link has expired. Please check your result again.")
    card = db.scalars(select(ReportCard).where(ReportCard.id == data["card"]).options(joinedload(ReportCard.enrollment), joinedload(ReportCard.term))).first()
    if not card:
        raise HTTPException(404, "Result not found")
    pdf, name = report_pdf_bytes(db, card)
    _log(db, request, ref=card.enrollment.student.student_no, success=True, reason="PDF", code=db.get(ResultAccessCode, data["code"]), student=card.enrollment.student, card=card)
    db.commit()
    return pdf_response(pdf, name)


def _mask_name(student: Student) -> str:
    return f"{student.first_name} {student.last_name[:1]}."


@router.get("/verify/{ref}/qr", dependencies=[Depends(rate_limit("verify", 60, 60))])
def verify_qr(ref: str):
    if not re.fullmatch(r"VR-[A-Z0-9]{10}", ref.upper()):
        raise HTTPException(404, "Not found")
    url = f"{settings.frontend_url.rstrip('/')}/verify/{ref.upper()}"
    return Response(qr_png(url), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/verify/{ref}", dependencies=[Depends(rate_limit("verify", 30, 60))])
def verify(ref: str, db: DB):
    card = db.scalars(
        select(ReportCard).where(ReportCard.verification_ref == ref.strip().upper()).options(
            joinedload(ReportCard.enrollment).joinedload(Enrollment.student),
            joinedload(ReportCard.enrollment).joinedload(Enrollment.school_class),
            joinedload(ReportCard.enrollment).joinedload(Enrollment.arm),
            joinedload(ReportCard.enrollment).joinedload(Enrollment.session),
            joinedload(ReportCard.term),
        )
    ).first()
    school = access.get_school(db)
    if not card or card.first_published_at is None:
        return {"valid": False, "school": school.name}
    e = card.enrollment
    return {
        "valid": True,
        "school": school.name,
        "reference": card.verification_ref,
        "student": _mask_name(e.student),
        "class_name": e.school_class.name + (f" {e.arm.name}" if e.arm else ""),
        "session": e.session.name,
        "term": card.term.name,
        "issued_at": card.first_published_at,
    }
