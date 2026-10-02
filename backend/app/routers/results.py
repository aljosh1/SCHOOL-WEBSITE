from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, get_or_404, has_perm, require_perm
from app.core.notify import notify, notify_roles
from app.core.permissions import Role
from app.core.storage import get_storage
from app.models import (
    ClassArm,
    Enrollment,
    ReportCard,
    Result,
    ResultAmendment,
    SchoolSettings,
    Student,
    Subject,
    Term,
    User,
)
from app.schemas import (
    AmendmentIn,
    BatchActionIn,
    BulkResultsIn,
    DecisionIn,
    RemarksIn,
    ResultCreate,
    ResultUpdate,
)
from app.services import access
from app.services import results as svc
from app.services.grading import active_entries
from app.services.pdf import report_card_pdf

router = APIRouter(tags=["results"])
settings = get_settings()


def _teacher_ctx(db: Session, user: User, session_id: int):
    if user.role != Role.TEACHER.value:
        return None
    t = access.teacher_for(db, user)
    if not t:
        raise HTTPException(403, "No teacher profile")
    return access.assignments_for(db, t.id, session_id)


def _scope_clause(assignments):
    conds = []
    for a in assignments:
        parts = [Enrollment.class_id == a.class_id, Result.subject_id == a.subject_id]
        if a.arm_id:
            parts.append(Enrollment.arm_id == a.arm_id)
        conds.append(and_(*parts))
    return or_(*conds) if conds else Result.id == -1


def _load_result(db: Session, rid: int) -> Result:
    r = db.scalars(
        select(Result)
        .where(Result.id == rid)
        .options(joinedload(Result.enrollment).joinedload(Enrollment.student), joinedload(Result.subject))
    ).first()
    if not r:
        raise HTTPException(404, "Result not found")
    return r


def _teacher_may_touch(db: Session, user: User, r: Result) -> None:
    if user.role == Role.STUDENT.value:
        raise HTTPException(403, "You do not have permission to perform this action")
    svc.assert_can_enter(db, user, r.enrollment, r.subject_id)


def _check_term_for(enrollment: Enrollment, term: Term) -> None:
    if term.session_id != enrollment.session_id:
        raise HTTPException(422, "The term does not belong to the student's session")


# ------------------------------------------------------------------ listing & entry sheet


@router.get("/results")
def list_results(
    db: DB,
    user: User = Depends(require_perm("results.read")),
    session_id: int | None = None,
    term_id: int | None = None,
    class_id: int | None = None,
    arm_id: int | None = None,
    subject_id: int | None = None,
    student_id: int | None = None,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
):
    sess = db.get(Term, term_id).session_id if term_id and db.get(Term, term_id) else session_id
    if sess is None:
        cur = access.current_session(db)
        sess = cur.id if cur else -1
    page_size = min(max(page_size, 1), 500)
    stmt = (
        select(Result)
        .join(Enrollment, Enrollment.id == Result.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.session_id == sess)
    )
    assignments = _teacher_ctx(db, user, sess)
    if assignments is not None:
        stmt = stmt.where(_scope_clause(assignments))
    for col, val in ((Result.term_id, term_id), (Enrollment.class_id, class_id), (Enrollment.arm_id, arm_id),
                     (Result.subject_id, subject_id), (Enrollment.student_id, student_id), (Result.status, status)):
        if val:
            stmt = stmt.where(col == val)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Student.first_name).like(like), func.lower(Student.last_name).like(like), func.lower(Student.student_no).like(like)))
    total = db.scalar(stmt.order_by(None).with_only_columns(func.count(Result.id), maintain_column_froms=True))
    rows = db.scalars(
        stmt.options(
            joinedload(Result.enrollment).joinedload(Enrollment.student),
            joinedload(Result.enrollment).joinedload(Enrollment.school_class),
            joinedload(Result.enrollment).joinedload(Enrollment.arm),
            joinedload(Result.subject),
        )
        .order_by(Student.last_name, Student.first_name, Result.subject_id)
        .offset((max(page, 1) - 1) * page_size)
        .limit(page_size)
    ).unique()
    return {"items": [svc.result_row(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/results/sheet")
def entry_sheet(
    db: DB,
    user: User = Depends(require_perm("results.read")),
    class_id: int = 0,
    subject_id: int = 0,
    term_id: int = 0,
    arm_id: int | None = None,
):
    term = get_or_404(db, Term, term_id, "Term")
    subject = get_or_404(db, Subject, subject_id, "Subject")
    assignments = _teacher_ctx(db, user, term.session_id)
    if assignments is not None and not access.can_teach(assignments, class_id, arm_id, subject_id):
        raise HTTPException(403, "You are not assigned to this class and subject")
    q = (
        select(Enrollment)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.session_id == term.session_id, Enrollment.class_id == class_id, Student.status == "ACTIVE")
        .options(joinedload(Enrollment.student))
        .order_by(Student.last_name, Student.first_name)
    )
    if arm_id:
        q = q.where(Enrollment.arm_id == arm_id)
    enrollments = list(db.scalars(q).unique())
    existing = {
        r.enrollment_id: r
        for r in db.scalars(
            select(Result).where(Result.subject_id == subject_id, Result.term_id == term_id, Result.enrollment_id.in_([e.id for e in enrollments] or [-1]))
        )
    }
    school = access.get_school(db)
    rows = []
    for e in enrollments:
        r = existing.get(e.id)
        rows.append(
            {
                "enrollment_id": e.id,
                "student_id": e.student_id,
                "student_name": e.student.full_name,
                "student_no": e.student.student_no,
                "result_id": r.id if r else None,
                "ca_score": r.ca_score if r else None,
                "exam_score": r.exam_score if r else None,
                "total": r.total if r else None,
                "grade": r.grade if r else None,
                "teacher_remark": r.teacher_remark if r else None,
                "status": r.status if r else "NOT_STARTED",
                "rejection_reason": r.rejection_reason if r else None,
            }
        )
    return {"subject": subject.name, "term": term.name, "ca_max": school.ca_max, "exam_max": school.exam_max, "rows": rows}


# ------------------------------------------------------------------ create / edit


@router.post("/results", status_code=201)
def create_result(body: ResultCreate, request: Request, db: DB, user: User = Depends(require_perm("results.write"))):
    e = get_or_404(db, Enrollment, body.enrollment_id, "Enrollment")
    term = get_or_404(db, Term, body.term_id, "Term")
    get_or_404(db, Subject, body.subject_id, "Subject")
    _check_term_for(e, term)
    svc.assert_can_enter(db, user, e, body.subject_id)
    if db.scalars(select(Result.id).where(Result.enrollment_id == e.id, Result.subject_id == body.subject_id, Result.term_id == term.id)).first():
        raise HTTPException(409, "A result already exists for this student, subject and term")
    school = access.get_school(db)
    r = Result(enrollment_id=e.id, subject_id=body.subject_id, term_id=term.id, status="DRAFT", entered_by_id=user.id, teacher_remark=body.teacher_remark)
    svc.apply_scores(active_entries(db), school, r, body.ca_score, body.exam_score)
    db.add(r)
    db.flush()
    audit(db, request, user, "RESULT_CREATE", "result", r.id, {"student_id": e.student_id, "subject_id": r.subject_id, "term_id": term.id})
    db.commit()
    return svc.result_row(_load_result(db, r.id))


@router.post("/results/bulk")
def bulk_save(body: BulkResultsIn, request: Request, db: DB, user: User = Depends(require_perm("results.write"))):
    term = get_or_404(db, Term, body.term_id, "Term")
    get_or_404(db, Subject, body.subject_id, "Subject")
    school = access.get_school(db)
    entries = active_entries(db)
    saved, skipped = [], []
    ids = [ln.enrollment_id for ln in body.lines]
    enrollments = {e.id: e for e in db.scalars(select(Enrollment).where(Enrollment.id.in_(ids)).options(joinedload(Enrollment.student)))}
    existing = {
        r.enrollment_id: r
        for r in db.scalars(select(Result).where(Result.subject_id == body.subject_id, Result.term_id == term.id, Result.enrollment_id.in_(ids)))
    }
    for ln in body.lines:
        e = enrollments.get(ln.enrollment_id)
        if not e or e.session_id != term.session_id:
            skipped.append({"enrollment_id": ln.enrollment_id, "reason": "Student is not enrolled in this term's session"})
            continue
        try:
            svc.assert_can_enter(db, user, e, body.subject_id)
        except HTTPException as exc:
            skipped.append({"enrollment_id": ln.enrollment_id, "reason": exc.detail})
            continue
        r = existing.get(e.id)
        if r is None and ln.ca_score is None and ln.exam_score is None:
            continue
        if r is not None and r.status not in svc.EDITABLE:
            skipped.append({"enrollment_id": e.id, "reason": f"Result is {r.status} and can no longer be edited"})
            continue
        try:
            if r is None:
                r = Result(enrollment_id=e.id, subject_id=body.subject_id, term_id=term.id, status="DRAFT", entered_by_id=user.id)
                db.add(r)
            svc.apply_scores(entries, school, r, ln.ca_score if ln.ca_score is not None else r.ca_score or 0,
                             ln.exam_score if ln.exam_score is not None else r.exam_score or 0)
        except HTTPException as exc:
            if r in db.new:
                db.expunge(r)
            skipped.append({"enrollment_id": e.id, "student": e.student.full_name, "reason": exc.detail})
            continue
        if "teacher_remark" in ln.model_fields_set:
            r.teacher_remark = ln.teacher_remark
        saved.append(e.id)
    db.flush()
    audit(db, request, user, "RESULT_BULK_SAVE", "result", None, {"subject_id": body.subject_id, "term_id": term.id, "saved": len(saved), "skipped": len(skipped)})
    db.commit()
    return {"saved": len(saved), "skipped": skipped}


@router.put("/results/{result_id}")
def update_result(result_id: int, body: ResultUpdate, request: Request, db: DB, user: User = Depends(require_perm("results.write"))):
    r = _load_result(db, result_id)
    _teacher_may_touch(db, user, r)
    if r.status not in svc.EDITABLE:
        raise HTTPException(409, f"This result is {r.status}. Published or submitted results cannot be edited directly; request an amendment instead.")
    school = access.get_school(db)
    d = body.model_dump(exclude_unset=True)
    before = {"ca": r.ca_score, "exam": r.exam_score}
    svc.apply_scores(active_entries(db), school, r, d.get("ca_score", r.ca_score), d.get("exam_score", r.exam_score))
    if "teacher_remark" in d:
        r.teacher_remark = d["teacher_remark"]
    audit(db, request, user, "RESULT_UPDATE", "result", r.id, {"before": before, "after": {"ca": r.ca_score, "exam": r.exam_score}})
    db.commit()
    return svc.result_row(r)


@router.delete("/results/{result_id}", status_code=204)
def delete_result(result_id: int, request: Request, db: DB, user: User = Depends(require_perm("results.write"))):
    r = _load_result(db, result_id)
    _teacher_may_touch(db, user, r)
    if r.status != "DRAFT":
        raise HTTPException(409, "Only draft results can be deleted")
    audit(db, request, user, "RESULT_DELETE", "result", r.id)
    db.delete(r)
    db.commit()


# ------------------------------------------------------------------ workflow


def _single(action: str, result_id: int, request: Request, db: Session, user: User, reason: str | None = None) -> Result:
    r = _load_result(db, result_id)
    school = access.get_school(db)
    if action == "submit":
        svc.submit(db, request, user, school, r)
    elif action == "approve":
        svc.approve(db, request, user, school, r)
    elif action == "reject":
        svc.reject(db, request, user, school, r, reason)
    elif action == "publish":
        svc.publish(db, request, user, school, r)
    return r


def _perm_for(action: str) -> str:
    return "results.submit" if action == "submit" else "results.approve"


def _authorize_action(db: Session, user: User, action: str) -> None:
    perm = _perm_for(action)
    if has_perm(db, user, perm):
        return
    # A teacher may approve/publish their own submissions only when the school enables it.
    if user.role == Role.TEACHER.value and action in ("approve", "publish") and access.get_school(db).allow_teacher_self_approval:
        return
    raise HTTPException(403, "You do not have permission to perform this action")


@router.post("/results/batch/{action}")
def batch_action(action: str, body: BatchActionIn, request: Request, db: DB, user: CurrentUser):
    if action not in ("submit", "approve", "reject", "publish"):
        raise HTTPException(404, "Not found")
    _authorize_action(db, user, action)
    done, failed = [], []
    submitted_subjects: set[str] = set()
    for rid in dict.fromkeys(body.ids):
        try:
            with db.begin_nested():
                r = _single(action, rid, request, db, user, body.reason)
            done.append(rid)
            if action == "submit":
                submitted_subjects.add(f"{r.subject.name} ({r.enrollment.school_class.name})")
        except HTTPException as exc:
            failed.append({"id": rid, "reason": exc.detail})
    if action == "submit" and done and access.get_school(db).require_approval:
        notify_roles(db, [Role.SUPER_ADMIN.value, Role.ADMIN.value], "Results submitted for approval",
                     f"{user.full_name} submitted {len(done)} result(s): {', '.join(sorted(submitted_subjects))[:300]}", "/portal/approvals")
    db.commit()
    return {"done": len(done), "failed": failed}


def _make_action(action: str):
    def handler(result_id: int, request: Request, db: DB, user: CurrentUser, body: DecisionIn | None = None):
        _authorize_action(db, user, action)
        r = _single(action, result_id, request, db, user, body.note if body else None)
        if action == "submit" and r.status == "SUBMITTED":
            notify_roles(db, [Role.SUPER_ADMIN.value, Role.ADMIN.value], "Result submitted for approval",
                         f"{user.full_name} submitted {r.subject.name} for {r.enrollment.student.full_name}.", "/portal/approvals")
        db.commit()
        return svc.result_row(r)

    handler.__name__ = f"result_{action}"
    return handler


for _action in ("submit", "approve", "reject", "publish"):
    router.add_api_route(f"/results/{{result_id}}/{_action}", _make_action(_action), methods=["POST"])


# ------------------------------------------------------------------ amendments


def _amendment_dict(a: ResultAmendment) -> dict:
    r = a.result
    return {
        "id": a.id,
        "result_id": r.id,
        "student_name": r.enrollment.student.full_name,
        "student_no": r.enrollment.student.student_no,
        "subject": r.subject.name,
        "class_name": r.enrollment.school_class.name,
        "old_ca": a.old_ca, "old_exam": a.old_exam, "new_ca": a.new_ca, "new_exam": a.new_exam,
        "reason": a.reason,
        "status": a.status,
        "requested_by": a.requested_by.full_name if a.requested_by else None,
        "requested_at": a.created_at,
        "decided_at": a.decided_at,
        "decision_note": a.decision_note,
    }


@router.post("/results/{result_id}/amendments", status_code=201)
def request_amendment(result_id: int, body: AmendmentIn, request: Request, db: DB, user: User = Depends(require_perm("results.amend"))):
    r = _load_result(db, result_id)
    school = access.get_school(db)
    a = svc.request_amendment(db, request, user, school, r, body.ca_score, body.exam_score, body.reason)
    if user.role != Role.TEACHER.value and has_perm(db, user, "results.amend_approve"):
        # Administrators amend directly; the request/decision is still recorded for audit.
        a.requested_by_id = user.id
        svc.decide_amendment(db, request, user, school, a, True, "Applied directly by administrator", allow_self=True)
    db.commit()
    return _amendment_dict(a)


@router.get("/amendments")
def list_amendments(db: DB, user: User = Depends(require_perm("results.amend", "results.amend_approve", any_of=True)), status: str | None = None):
    stmt = select(ResultAmendment).options(
        joinedload(ResultAmendment.result).joinedload(Result.enrollment).joinedload(Enrollment.student),
        joinedload(ResultAmendment.result).joinedload(Result.enrollment).joinedload(Enrollment.school_class),
        joinedload(ResultAmendment.result).joinedload(Result.subject),
        joinedload(ResultAmendment.requested_by),
    ).order_by(ResultAmendment.created_at.desc()).limit(300)
    if status:
        stmt = stmt.where(ResultAmendment.status == status)
    if not has_perm(db, user, "results.amend_approve"):
        stmt = stmt.where(ResultAmendment.requested_by_id == user.id)
    return [_amendment_dict(a) for a in db.scalars(stmt).unique()]


@router.post("/amendments/{amendment_id}/{action}")
def decide(amendment_id: int, action: str, body: DecisionIn, request: Request, db: DB, user: User = Depends(require_perm("results.amend_approve"))):
    if action not in ("approve", "reject"):
        raise HTTPException(404, "Not found")
    a = get_or_404(db, ResultAmendment, amendment_id, "Amendment")
    svc.decide_amendment(db, request, user, access.get_school(db), a, action == "approve", body.note)
    db.commit()
    return _amendment_dict(a)


# ------------------------------------------------------------------ history & report cards


def _authorize_card(db: Session, user: User, card: ReportCard) -> None:
    e = card.enrollment
    if user.role == Role.STUDENT.value:
        s = access.student_for(db, user)
        if not s or s.id != e.student_id:
            raise HTTPException(404, "Result not found")
    elif user.role == Role.TEACHER.value:
        t = access.teacher_for(db, user)
        if not t or not access.teacher_can_see_student(db, t, e.student_id):
            raise HTTPException(404, "Result not found")
    elif not has_perm(db, user, "results.read"):
        raise HTTPException(403, "You do not have permission to perform this action")


@router.get("/results/history")
def history(db: DB, user: CurrentUser, student_id: int | None = None):
    if user.role == Role.STUDENT.value:
        s = access.student_for(db, user)
        if not s:
            raise HTTPException(404, "No student profile is linked to this account")
        sid = s.id
    else:
        if not student_id or not has_perm(db, user, "results.read"):
            raise HTTPException(403, "You do not have permission to perform this action")
        if user.role == Role.TEACHER.value:
            t = access.teacher_for(db, user)
            if not t or not access.teacher_can_see_student(db, t, student_id):
                raise HTTPException(404, "Student not found")
        sid = student_id
    cards = db.scalars(
        select(ReportCard)
        .join(Enrollment, Enrollment.id == ReportCard.enrollment_id)
        .where(Enrollment.student_id == sid)
        .options(joinedload(ReportCard.enrollment).joinedload(Enrollment.session), joinedload(ReportCard.term))
    ).unique()
    school = access.get_school(db)
    sessions: dict[str, dict] = {}
    for c in sorted(cards, key=lambda c: (c.enrollment.session.name, c.term.position), reverse=True):
        rep = svc.build_report(db, c.enrollment, c.term_id, school)
        if not rep:
            continue
        sess = sessions.setdefault(c.enrollment.session.name, {"session": c.enrollment.session.name, "terms": []})
        sess["terms"].append(
            {
                "card_id": c.id, "term": c.term.name, "term_id": c.term_id,
                "average": rep["summary"]["average"], "overall_grade": rep["summary"]["overall_grade"],
                "position": rep["summary"]["position_label"], "class_name": rep["class_name"],
            }
        )
    return list(sessions.values())


def _photo_bytes(student) -> bytes | None:
    if not student.photo_key:
        return None
    try:
        return get_storage().read(student.photo_key)
    except Exception:
        return None


def _asset(key: str | None) -> bytes | None:
    if not key:
        return None
    try:
        return get_storage().read(key)
    except Exception:
        return None


def report_pdf_bytes(db: Session, card: ReportCard) -> tuple[bytes, str]:
    school = access.get_school(db)
    e = card.enrollment
    rep = svc.build_report(db, e, card.term_id, school)
    if not rep:
        raise HTTPException(404, "Result not found")
    verify_url = f"{settings.frontend_url.rstrip('/')}/verify/{card.verification_ref}"
    data = report_card_pdf(
        rep, school, _photo_bytes(e.student), _asset(school.logo_key), _asset(school.stamp_key), _asset(school.signature_key), verify_url
    )
    safe = "".join(c if c.isalnum() else "_" for c in e.student.full_name)
    return data, f"Result_{safe}_{card.term.name.replace(' ', '')}.pdf".replace("__", "_")


def pdf_response(data: bytes, filename: str, inline: bool = False) -> Response:
    return Response(
        data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _load_card(db: Session, card_id: int) -> ReportCard:
    card = db.scalars(
        select(ReportCard).where(ReportCard.id == card_id).options(joinedload(ReportCard.enrollment), joinedload(ReportCard.term))
    ).first()
    if not card:
        raise HTTPException(404, "Result not found")
    return card


@router.get("/report-cards/{card_id}")
def get_report_card(card_id: int, db: DB, user: CurrentUser):
    card = _load_card(db, card_id)
    _authorize_card(db, user, card)
    school = access.get_school(db)
    rep = svc.build_report(db, card.enrollment, card.term_id, school)
    if not rep:
        raise HTTPException(404, "Result not found")
    s = card.enrollment.student
    rep["student"]["photo_url"] = f"/api/students/{s.id}/photo" if s.photo_key else None
    return rep


@router.get("/report-cards/{card_id}/pdf")
def get_report_card_pdf(card_id: int, db: DB, user: CurrentUser, request: Request, inline: bool = False):
    card = _load_card(db, card_id)
    _authorize_card(db, user, card)
    data, name = report_pdf_bytes(db, card)
    audit(db, request, user, "RESULT_PDF_DOWNLOAD", "report_card", card.id)
    db.commit()
    return pdf_response(data, name, inline)


@router.put("/report-cards/{card_id}/remarks")
def set_remarks(card_id: int, body: RemarksIn, request: Request, db: DB, user: CurrentUser):
    card = _load_card(db, card_id)
    is_admin = user.role in (Role.SUPER_ADMIN.value, Role.ADMIN.value)
    if not is_admin:
        t = access.teacher_for(db, user) if user.role == Role.TEACHER.value else None
        arm = db.get(ClassArm, card.enrollment.arm_id) if card.enrollment.arm_id else None
        if not t or not arm or arm.form_teacher_id != t.id:
            raise HTTPException(403, "Only the class teacher or an administrator can edit remarks")
        if "principal_remark" in body.model_fields_set:
            raise HTTPException(403, "Only an administrator can edit the principal's remark")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(card, k, v)
    audit(db, request, user, "REPORT_REMARKS_UPDATE", "report_card", card.id, {"fields": sorted(data)})
    db.commit()
    return {"ok": True}


@router.get("/report-cards")
def find_cards(db: DB, user: User = Depends(require_perm("results.read")), enrollment_id: int | None = None, term_id: int | None = None):
    """Admin/teacher lookup of a student's report card id for a term."""
    if not enrollment_id or not term_id:
        raise HTTPException(422, "enrollment_id and term_id are required")
    card = db.scalars(select(ReportCard).where(ReportCard.enrollment_id == enrollment_id, ReportCard.term_id == term_id)).first()
    if not card:
        raise HTTPException(404, "No published result for this student and term")
    _authorize_card(db, user, card)
    return {"card_id": card.id}


# ------------------------------------------------------------------ reports


@router.get("/reports/class-performance")
def class_performance(
    db: DB,
    user: User = Depends(require_perm("reports.read")),
    term_id: int = 0,
    class_id: int = 0,
    arm_id: int | None = None,
):
    term = get_or_404(db, Term, term_id, "Term")
    school = access.get_school(db)
    assignments = _teacher_ctx(db, user, term.session_id)
    allowed_subjects: set[int] | None = None
    if assignments is not None:
        mine = [a for a in assignments if a.class_id == class_id and (arm_id is None or a.arm_id in (None, arm_id))]
        if not mine:
            raise HTTPException(403, "You do not teach this class")
        allowed_subjects = {a.subject_id for a in mine}
    stmt = (
        select(Result)
        .join(Enrollment, Enrollment.id == Result.enrollment_id)
        .where(Enrollment.session_id == term.session_id, Enrollment.class_id == class_id, Result.term_id == term.id, Result.status == "PUBLISHED")
        .options(joinedload(Result.subject), joinedload(Result.enrollment).joinedload(Enrollment.student))
    )
    if arm_id:
        stmt = stmt.where(Enrollment.arm_id == arm_id)
    rows = list(db.scalars(stmt).unique())
    pass_mark = min((g.min_score for g in active_entries(db) if (g.grade_point or 0) > 0), default=40)
    by_sub: dict[int, list[Result]] = defaultdict(list)
    by_student: dict[int, list[Result]] = defaultdict(list)
    for r in rows:
        by_sub[r.subject_id].append(r)
        by_student[r.enrollment_id].append(r)
    subjects = []
    for sid, rs in by_sub.items():
        if allowed_subjects is not None and sid not in allowed_subjects:
            continue
        totals = [x.total for x in rs]
        subjects.append(
            {
                "subject": rs[0].subject.name,
                "students": len(rs),
                "average": round(sum(totals) / len(totals), 2),
                "highest": max(totals),
                "lowest": min(totals),
                "pass_rate": round(100 * sum(1 for t in totals if t >= pass_mark) / len(totals), 1),
            }
        )
    subjects.sort(key=lambda x: x["subject"])
    ranking = []
    if allowed_subjects is None:
        ranked = sorted(
            ((sum(x.total for x in rs) / len(rs), rs[0].enrollment.student) for rs in by_student.values()), key=lambda t: -t[0]
        )
        last_avg, last_pos = None, 0
        for i, (avg, st) in enumerate(ranked, 1):
            pos = last_pos if round(avg, 2) == last_avg else i
            last_avg, last_pos = round(avg, 2), pos
            ranking.append({"position": svc.ordinal(pos), "student": st.full_name, "student_no": st.student_no, "average": round(avg, 2)})
    return {"term": term.name, "pass_mark": pass_mark, "subjects": subjects, "ranking": ranking, "max_total": school.ca_max + school.exam_max}
