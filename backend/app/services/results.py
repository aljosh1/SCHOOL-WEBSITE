from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.notify import notify, notify_roles
from app.core.permissions import Role
from app.core.security import new_verification_ref, utcnow
from app.models import (
    Enrollment,
    GradeEntry,
    Result,
    ResultAmendment,
    ReportCard,
    SchoolSettings,
    Student,
    Term,
    User,
)
from app.services import access
from app.services.grading import active_entries, grade_for

EDITABLE = {"DRAFT"}


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def validate_scores(school: SchoolSettings, ca: float, exam: float) -> None:
    if ca > school.ca_max:
        raise HTTPException(422, f"CA/Test score cannot exceed {school.ca_max:g}")
    if exam > school.exam_max:
        raise HTTPException(422, f"Exam score cannot exceed {school.exam_max:g}")


def apply_scores(entries: list[GradeEntry], school: SchoolSettings, r: Result, ca: float, exam: float) -> None:
    validate_scores(school, ca, exam)
    r.ca_score, r.exam_score = round(ca, 2), round(exam, 2)
    r.total = round(ca + exam, 2)
    g = grade_for(entries, r.total)
    r.grade = g.grade if g else None
    r.grade_description = g.description if g else None
    r.grade_point = g.grade_point if g else None


def assert_can_enter(db: Session, user: User, enrollment: Enrollment, subject_id: int) -> None:
    if user.role in (Role.SUPER_ADMIN.value, Role.ADMIN.value):
        return
    teacher = access.teacher_for(db, user)
    if not teacher:
        raise HTTPException(403, "No teacher profile")
    items = access.assignments_for(db, teacher.id, enrollment.session_id)
    if not access.can_teach(items, enrollment.class_id, enrollment.arm_id, subject_id):
        raise HTTPException(403, "You are not assigned to this class and subject")


def _can_approve(db: Session, user: User, school: SchoolSettings, r: Result) -> None:
    """Enforces who may approve/publish; raises 403 otherwise."""
    if user.role == Role.TEACHER.value:
        if not (school.allow_teacher_self_approval and r.submitted_by_id == user.id):
            raise HTTPException(403, "Only an administrator can approve results")
        assert_can_enter(db, user, r.enrollment, r.subject_id)
        return
    if r.submitted_by_id == user.id and user.role != Role.SUPER_ADMIN.value and not school.allow_teacher_self_approval:
        raise HTTPException(403, "You cannot approve results you submitted yourself")


def _guard_state(r: Result, allowed: set[str], verb: str) -> None:
    if r.status not in allowed:
        raise HTTPException(409, f"Cannot {verb} a result that is {r.status}")


def submit(db: Session, request: Request, user: User, school: SchoolSettings, r: Result) -> None:
    assert_can_enter(db, user, r.enrollment, r.subject_id)
    _guard_state(r, {"DRAFT"}, "submit")
    r.status = "SUBMITTED"
    r.submitted_by_id, r.submitted_at, r.rejection_reason = user.id, utcnow(), None
    audit(db, request, user, "RESULT_SUBMIT", "result", r.id, {"subject_id": r.subject_id, "term_id": r.term_id})
    if not school.require_approval:
        _approve(db, request, user, r)
        publish(db, request, user, school, r, skip_checks=True)


def _approve(db: Session, request: Request, user: User, r: Result) -> None:
    r.status = "APPROVED"
    r.approved_by_id, r.approved_at = user.id, utcnow()
    audit(db, request, user, "RESULT_APPROVE", "result", r.id)


def approve(db: Session, request: Request, user: User, school: SchoolSettings, r: Result) -> None:
    _guard_state(r, {"SUBMITTED"}, "approve")
    _can_approve(db, user, school, r)
    _approve(db, request, user, r)


def reject(db: Session, request: Request, user: User, school: SchoolSettings, r: Result, reason: str | None) -> None:
    _guard_state(r, {"SUBMITTED", "APPROVED"}, "reject")
    if user.role == Role.TEACHER.value:
        raise HTTPException(403, "Only an administrator can return results")
    r.status = "DRAFT"
    r.rejection_reason = reason or "Returned for correction"
    r.approved_by_id = r.approved_at = None
    audit(db, request, user, "RESULT_REJECT", "result", r.id, {"reason": reason})
    teacher_user_ids = [r.entered_by_id] if r.entered_by_id else []
    notify(
        db,
        teacher_user_ids,
        "Result returned for correction",
        f"{r.subject.name} result for {r.enrollment.student.full_name} was returned: {r.rejection_reason}",
        "/portal/results",
    )


def publish(
    db: Session, request: Request, user: User, school: SchoolSettings, r: Result, skip_checks: bool = False
) -> None:
    if not skip_checks:
        _guard_state(r, {"APPROVED", "SUBMITTED"} if not school.require_approval else {"APPROVED"}, "publish")
        _can_approve(db, user, school, r)
    r.status = "PUBLISHED"
    r.published_by_id, r.published_at = user.id, utcnow()
    card, created = ensure_report_card(db, r.enrollment_id, r.term_id)
    audit(db, request, user, "RESULT_PUBLISH", "result", r.id, {"report_card": card.verification_ref})
    if created or card.first_published_at is None:
        card.first_published_at = r.published_at
        student = r.enrollment.student
        term = db.get(Term, r.term_id)
        if student.user_id:
            notify(
                db,
                [student.user_id],
                "Result published",
                f"Your {term.name} result has been published.",
                "/portal/my-results",
            )


def ensure_report_card(db: Session, enrollment_id: int, term_id: int) -> tuple[ReportCard, bool]:
    card = db.scalars(
        select(ReportCard).where(ReportCard.enrollment_id == enrollment_id, ReportCard.term_id == term_id)
    ).first()
    if card:
        return card, False
    for _ in range(5):
        card = ReportCard(enrollment_id=enrollment_id, term_id=term_id, verification_ref=new_verification_ref())
        try:
            with db.begin_nested():
                db.add(card)
                db.flush()
            return card, True
        except IntegrityError:
            existing = db.scalars(
                select(ReportCard).where(ReportCard.enrollment_id == enrollment_id, ReportCard.term_id == term_id)
            ).first()
            if existing:
                return existing, False
    raise HTTPException(500, "Could not allocate a verification reference")


# ------------------------------------------------------------------ amendments


def request_amendment(
    db: Session, request: Request, user: User, school: SchoolSettings, r: Result, ca: float, exam: float, reason: str
) -> ResultAmendment:
    if r.status != "PUBLISHED":
        raise HTTPException(409, "Only published results need an amendment; edit the draft instead")
    assert_can_enter(db, user, r.enrollment, r.subject_id)
    validate_scores(school, ca, exam)
    pending = db.scalars(
        select(ResultAmendment).where(ResultAmendment.result_id == r.id, ResultAmendment.status == "PENDING")
    ).first()
    if pending:
        raise HTTPException(409, "An amendment is already pending for this result")
    a = ResultAmendment(
        result_id=r.id,
        requested_by_id=user.id,
        old_ca=r.ca_score,
        old_exam=r.exam_score,
        new_ca=ca,
        new_exam=exam,
        reason=reason,
    )
    db.add(a)
    db.flush()
    audit(db, request, user, "RESULT_AMEND_REQUEST", "result", r.id, {"amendment": a.id, "reason": reason})
    notify_roles(
        db,
        [Role.SUPER_ADMIN.value, Role.ADMIN.value],
        "Result amendment requested",
        f"{user.full_name} requested a correction to {r.subject.name} for {r.enrollment.student.full_name}.",
        "/portal/amendments",
    )
    return a


def decide_amendment(
    db: Session, request: Request, user: User, school: SchoolSettings, a: ResultAmendment, approve_it: bool, note: str | None,
    allow_self: bool = False,
) -> None:
    if a.status != "PENDING":
        raise HTTPException(409, "This amendment has already been decided")
    if approve_it and a.requested_by_id == user.id and not allow_self and user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(403, "You cannot approve your own amendment request")
    r = a.result
    a.status = "APPROVED" if approve_it else "REJECTED"
    a.decided_by_id, a.decided_at, a.decision_note = user.id, utcnow(), note
    if approve_it:
        entries = active_entries(db)
        before = {"ca": r.ca_score, "exam": r.exam_score, "total": r.total, "grade": r.grade}
        apply_scores(entries, school, r, a.new_ca, a.new_exam)
        r.version += 1
        audit(
            db, request, user, "RESULT_AMEND_APPLY", "result", r.id,
            {"amendment": a.id, "before": before, "after": {"ca": r.ca_score, "exam": r.exam_score, "total": r.total, "grade": r.grade}, "reason": a.reason, "version": r.version},
        )
        if r.enrollment.student.user_id:
            notify(db, [r.enrollment.student.user_id], "Result updated", f"Your {r.subject.name} result was corrected.", "/portal/my-results")
    else:
        audit(db, request, user, "RESULT_AMEND_REJECT", "result", r.id, {"amendment": a.id, "note": note})
    if a.requested_by_id and a.requested_by_id != user.id:
        notify(
            db, [a.requested_by_id],
            f"Amendment {'approved' if approve_it else 'rejected'}",
            f"Your amendment for {r.subject.name} ({r.enrollment.student.full_name}) was {'approved' if approve_it else 'rejected'}.",
            "/portal/results",
        )


# ------------------------------------------------------------------ report cards


def _cohort_published(db: Session, e: Enrollment, term_id: int) -> list[Result]:
    q = (
        select(Result)
        .join(Enrollment, Enrollment.id == Result.enrollment_id)
        .where(
            Enrollment.session_id == e.session_id,
            Enrollment.class_id == e.class_id,
            Result.term_id == term_id,
            Result.status == "PUBLISHED",
        )
        .options(joinedload(Result.subject))
    )
    q = q.where(Enrollment.arm_id == e.arm_id) if e.arm_id else q.where(Enrollment.arm_id.is_(None))
    return list(db.scalars(q).unique())


def build_report(db: Session, e: Enrollment, term_id: int, school: SchoolSettings) -> dict | None:
    cohort = _cohort_published(db, e, term_id)
    mine = [r for r in cohort if r.enrollment_id == e.id]
    if not mine:
        return None
    entries = active_entries(db)

    totals: dict[int, float] = defaultdict(float)
    counts: dict[int, int] = defaultdict(int)
    by_subject: dict[int, list[float]] = defaultdict(list)
    for r in cohort:
        totals[r.enrollment_id] += r.total
        counts[r.enrollment_id] += 1
        by_subject[r.subject_id].append(r.total)
    averages = {k: totals[k] / counts[k] for k in totals}
    my_avg = averages[e.id]
    position = 1 + sum(1 for v in averages.values() if round(v, 2) > round(my_avg, 2))

    subjects = []
    for r in sorted(mine, key=lambda x: x.subject.name):
        scores = by_subject[r.subject_id]
        spos = 1 + sum(1 for s in scores if s > r.total)
        subjects.append(
            {
                "subject": r.subject.name,
                "subject_code": r.subject.code,
                "ca_score": r.ca_score,
                "exam_score": r.exam_score,
                "total": r.total,
                "grade": r.grade,
                "grade_description": r.grade_description,
                "grade_point": r.grade_point,
                "position": spos if school.show_position else None,
                "position_label": ordinal(spos) if school.show_position else None,
                "class_average": round(sum(scores) / len(scores), 2),
                "remark": r.teacher_remark,
            }
        )

    overall = grade_for(entries, my_avg)
    card = db.scalars(
        select(ReportCard).where(ReportCard.enrollment_id == e.id, ReportCard.term_id == term_id)
    ).first()
    term = db.get(Term, term_id)
    student: Student = e.student
    class_name = e.school_class.name + (f" {e.arm.name}" if e.arm else "")
    gpa_points = [s["grade_point"] for s in subjects if s["grade_point"] is not None]
    return {
        "card_id": card.id if card else None,
        "verification_ref": card.verification_ref if card else None,
        "published_at": (card.first_published_at if card else None),
        "student": {
            "id": student.id,
            "student_no": student.student_no,
            "admission_no": student.admission_no,
            "name": student.full_name,
            "gender": student.gender,
            "date_of_birth": student.date_of_birth.isoformat() if student.date_of_birth else None,
        },
        "class_name": class_name,
        "session": e.session.name,
        "session_id": e.session_id,
        "term": term.name,
        "term_id": term.id,
        "next_term_begins": term.next_term_begins.isoformat() if term.next_term_begins else None,
        "subjects": subjects,
        "summary": {
            "subjects_count": len(subjects),
            "total_score": round(totals[e.id], 2),
            "average": round(my_avg, 2),
            "overall_grade": overall.grade if overall else None,
            "overall_description": overall.description if overall else None,
            "gpa": round(sum(gpa_points) / len(gpa_points), 2) if gpa_points else None,
            "position": position if school.show_position else None,
            "position_label": ordinal(position) if school.show_position else None,
            "class_size": len(averages),
            "class_average": round(sum(averages.values()) / len(averages), 2),
        },
        "teacher_remark": (card.teacher_remark if card and card.teacher_remark else (overall.remark if overall else None)),
        "principal_remark": (
            card.principal_remark if card and card.principal_remark else (overall.principal_remark if overall else None)
        ),
        "ca_max": school.ca_max,
        "exam_max": school.exam_max,
        "total_max": school.ca_max + school.exam_max,
        "grading": [
            {"grade": g.grade, "description": g.description, "min": g.min_score, "max": g.max_score}
            for g in entries
        ],
    }


def result_row(r: Result) -> dict:
    e = r.enrollment
    s = e.student
    return {
        "id": r.id,
        "enrollment_id": r.enrollment_id,
        "student_id": s.id,
        "student_name": s.full_name,
        "student_no": s.student_no,
        "class_id": e.class_id,
        "arm_id": e.arm_id,
        "class_name": e.school_class.name + (f" {e.arm.name}" if e.arm else ""),
        "session_id": e.session_id,
        "subject_id": r.subject_id,
        "subject": r.subject.name,
        "term_id": r.term_id,
        "ca_score": r.ca_score,
        "exam_score": r.exam_score,
        "total": r.total,
        "grade": r.grade,
        "grade_description": r.grade_description,
        "grade_point": r.grade_point,
        "teacher_remark": r.teacher_remark,
        "status": r.status,
        "version": r.version,
        "rejection_reason": r.rejection_reason,
        "submitted_at": r.submitted_at,
        "published_at": r.published_at,
    }


def now() -> datetime:
    return utcnow()
