from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, get_or_404, require_perm
from app.models import (
    AcademicSession,
    ClassArm,
    Enrollment,
    GradeEntry,
    GradingScale,
    Result,
    SchoolClass,
    Subject,
    Teacher,
    Term,
    User,
)
from app.schemas import ArmIn, ClassIn, GradingScaleIn, SessionIn, SubjectIn, TermIn
from app.services import access
from app.services.grading import active_entries, validate_scale
from app.services.results import apply_scores

router = APIRouter(tags=["academics"])
write = require_perm("academics.write")


def _commit_or_409(db, message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, message)


def session_dict(s: AcademicSession) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "start_date": s.start_date,
        "end_date": s.end_date,
        "is_current": s.is_current,
        "terms": [term_dict(t) for t in s.terms],
    }


def term_dict(t: Term) -> dict:
    return {
        "id": t.id,
        "session_id": t.session_id,
        "name": t.name,
        "position": t.position,
        "start_date": t.start_date,
        "end_date": t.end_date,
        "next_term_begins": t.next_term_begins,
        "is_current": t.is_current,
    }


# ------------------------------------------------------------------ sessions & terms


@router.get("/sessions")
def list_sessions(db: DB, _: CurrentUser):
    rows = db.scalars(select(AcademicSession).options(joinedload(AcademicSession.terms)).order_by(AcademicSession.name.desc())).unique()
    return [session_dict(s) for s in rows]


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, request: Request, db: DB, user: User = Depends(write)):
    s = AcademicSession(name=body.name, start_date=body.start_date, end_date=body.end_date, is_current=False)
    db.add(s)
    if body.create_default_terms:
        for i, n in enumerate(("First Term", "Second Term", "Third Term"), 1):
            s.terms.append(Term(name=n, position=i))
    if not db.scalars(select(AcademicSession.id).where(AcademicSession.is_current.is_(True))).first():
        s.is_current = True
        if s.terms:
            s.terms[0].is_current = True
    _commit_or_409(db, "A session with that name already exists")
    audit(db, request, user, "SESSION_CREATE", "session", s.id, {"name": s.name})
    db.commit()
    return session_dict(s)


@router.put("/sessions/{session_id}")
def update_session(session_id: int, body: SessionIn, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, AcademicSession, session_id, "Session")
    s.name, s.start_date, s.end_date = body.name, body.start_date, body.end_date
    _commit_or_409(db, "A session with that name already exists")
    audit(db, request, user, "SESSION_UPDATE", "session", s.id)
    db.commit()
    return session_dict(s)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, AcademicSession, session_id, "Session")
    if s.is_current:
        raise HTTPException(409, "The current session cannot be deleted")
    audit(db, request, user, "SESSION_DELETE", "session", s.id, {"name": s.name})
    db.delete(s)
    _commit_or_409(db, "This session has students, results or other records and cannot be deleted")


@router.post("/sessions/{session_id}/set-current")
def set_current_session(session_id: int, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, AcademicSession, session_id, "Session")
    db.execute(update(AcademicSession).values(is_current=False))
    db.execute(update(Term).values(is_current=False))
    s.is_current = True
    if s.terms:
        s.terms[0].is_current = True
    audit(db, request, user, "SESSION_SET_CURRENT", "session", s.id)
    db.commit()
    return session_dict(s)


@router.post("/sessions/{session_id}/terms", status_code=201)
def create_term(session_id: int, body: TermIn, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, AcademicSession, session_id, "Session")
    t = Term(session_id=s.id, **body.model_dump())
    db.add(t)
    _commit_or_409(db, "A term with that name or position already exists in this session")
    audit(db, request, user, "TERM_CREATE", "term", t.id)
    db.commit()
    return term_dict(t)


@router.put("/terms/{term_id}")
def update_term(term_id: int, body: TermIn, request: Request, db: DB, user: User = Depends(write)):
    t = get_or_404(db, Term, term_id, "Term")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    _commit_or_409(db, "A term with that name or position already exists in this session")
    audit(db, request, user, "TERM_UPDATE", "term", t.id)
    db.commit()
    return term_dict(t)


@router.delete("/terms/{term_id}", status_code=204)
def delete_term(term_id: int, request: Request, db: DB, user: User = Depends(write)):
    t = get_or_404(db, Term, term_id, "Term")
    if t.is_current:
        raise HTTPException(409, "The current term cannot be deleted")
    audit(db, request, user, "TERM_DELETE", "term", t.id)
    db.delete(t)
    _commit_or_409(db, "This term has results or other records and cannot be deleted")


@router.post("/terms/{term_id}/set-current")
def set_current_term(term_id: int, request: Request, db: DB, user: User = Depends(write)):
    t = get_or_404(db, Term, term_id, "Term")
    db.execute(update(AcademicSession).values(is_current=False))
    db.execute(update(Term).values(is_current=False))
    t.is_current = True
    t.session.is_current = True
    audit(db, request, user, "TERM_SET_CURRENT", "term", t.id)
    db.commit()
    return term_dict(t)


# ------------------------------------------------------------------ classes & arms


def class_dict(c: SchoolClass) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "level_order": c.level_order,
        "arms": [
            {
                "id": a.id,
                "name": a.name,
                "form_teacher_id": a.form_teacher_id,
                "form_teacher": a.form_teacher.user.full_name if a.form_teacher else None,
            }
            for a in c.arms
        ],
    }


@router.get("/classes")
def list_classes(db: DB, _: CurrentUser):
    rows = db.scalars(
        select(SchoolClass)
        .options(joinedload(SchoolClass.arms).joinedload(ClassArm.form_teacher).joinedload(Teacher.user))
        .order_by(SchoolClass.level_order, SchoolClass.name)
    ).unique()
    return [class_dict(c) for c in rows]


@router.post("/classes", status_code=201)
def create_class(body: ClassIn, request: Request, db: DB, user: User = Depends(write)):
    c = SchoolClass(**body.model_dump())
    db.add(c)
    _commit_or_409(db, "A class with that name already exists")
    audit(db, request, user, "CLASS_CREATE", "class", c.id, {"name": c.name})
    db.commit()
    return class_dict(c)


@router.put("/classes/{class_id}")
def update_class(class_id: int, body: ClassIn, request: Request, db: DB, user: User = Depends(write)):
    c = get_or_404(db, SchoolClass, class_id, "Class")
    c.name, c.level_order = body.name, body.level_order
    _commit_or_409(db, "A class with that name already exists")
    audit(db, request, user, "CLASS_UPDATE", "class", c.id)
    db.commit()
    return class_dict(c)


@router.delete("/classes/{class_id}", status_code=204)
def delete_class(class_id: int, request: Request, db: DB, user: User = Depends(write)):
    c = get_or_404(db, SchoolClass, class_id, "Class")
    audit(db, request, user, "CLASS_DELETE", "class", c.id, {"name": c.name})
    db.delete(c)
    _commit_or_409(db, "This class has students or other records and cannot be deleted")


@router.post("/classes/{class_id}/arms", status_code=201)
def create_arm(class_id: int, body: ArmIn, request: Request, db: DB, user: User = Depends(write)):
    c = get_or_404(db, SchoolClass, class_id, "Class")
    arm = ClassArm(class_id=c.id, name=body.name, form_teacher_id=body.form_teacher_id)
    db.add(arm)
    _commit_or_409(db, "That arm already exists for this class")
    audit(db, request, user, "ARM_CREATE", "arm", arm.id)
    db.commit()
    return class_dict(c)


@router.put("/arms/{arm_id}")
def update_arm(arm_id: int, body: ArmIn, request: Request, db: DB, user: User = Depends(write)):
    arm = get_or_404(db, ClassArm, arm_id, "Arm")
    arm.name, arm.form_teacher_id = body.name, body.form_teacher_id
    _commit_or_409(db, "That arm already exists for this class")
    audit(db, request, user, "ARM_UPDATE", "arm", arm.id)
    db.commit()
    return class_dict(arm.school_class)


@router.delete("/arms/{arm_id}", status_code=204)
def delete_arm(arm_id: int, request: Request, db: DB, user: User = Depends(write)):
    arm = get_or_404(db, ClassArm, arm_id, "Arm")
    if db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.arm_id == arm.id)):
        raise HTTPException(409, "This arm has students and cannot be deleted")
    audit(db, request, user, "ARM_DELETE", "arm", arm.id)
    db.delete(arm)
    _commit_or_409(db, "This arm is in use and cannot be deleted")


# ------------------------------------------------------------------ subjects


def subject_dict(s: Subject) -> dict:
    return {"id": s.id, "name": s.name, "code": s.code, "category": s.category, "is_active": s.is_active}


@router.get("/subjects")
def list_subjects(db: DB, _: CurrentUser, active_only: bool = False):
    q = select(Subject).order_by(Subject.name)
    if active_only:
        q = q.where(Subject.is_active.is_(True))
    return [subject_dict(s) for s in db.scalars(q)]


@router.post("/subjects", status_code=201)
def create_subject(body: SubjectIn, request: Request, db: DB, user: User = Depends(write)):
    s = Subject(**body.model_dump())
    db.add(s)
    _commit_or_409(db, "A subject with that name or code already exists")
    audit(db, request, user, "SUBJECT_CREATE", "subject", s.id, {"name": s.name})
    db.commit()
    return subject_dict(s)


@router.put("/subjects/{subject_id}")
def update_subject(subject_id: int, body: SubjectIn, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, Subject, subject_id, "Subject")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    _commit_or_409(db, "A subject with that name or code already exists")
    audit(db, request, user, "SUBJECT_UPDATE", "subject", s.id)
    db.commit()
    return subject_dict(s)


@router.delete("/subjects/{subject_id}", status_code=204)
def delete_subject(subject_id: int, request: Request, db: DB, user: User = Depends(write)):
    s = get_or_404(db, Subject, subject_id, "Subject")
    audit(db, request, user, "SUBJECT_DELETE", "subject", s.id, {"name": s.name})
    db.delete(s)
    _commit_or_409(db, "This subject has results or materials. Deactivate it instead.")


# ------------------------------------------------------------------ grading


def scale_dict(db) -> dict:
    school = access.get_school(db)
    scale = db.scalars(select(GradingScale).where(GradingScale.is_active.is_(True)).limit(1)).first()
    return {
        "name": scale.name if scale else None,
        "ca_max": school.ca_max,
        "exam_max": school.exam_max,
        "entries": [
            {
                "grade": e.grade,
                "description": e.description,
                "min_score": e.min_score,
                "max_score": e.max_score,
                "grade_point": e.grade_point,
                "remark": e.remark,
                "principal_remark": e.principal_remark,
            }
            for e in (active_entries(db))
        ],
    }


@router.get("/grading-scale")
def get_grading_scale(db: DB, _: CurrentUser):
    return scale_dict(db)


@router.put("/grading-scale")
def put_grading_scale(body: GradingScaleIn, request: Request, db: DB, user: User = Depends(write)):
    school = access.get_school(db)
    validate_scale([(e.min_score, e.max_score) for e in body.entries], school.ca_max + school.exam_max)
    if len({e.grade.upper() for e in body.entries}) != len(body.entries):
        raise HTTPException(422, "Grade letters must be unique")
    for old in db.scalars(select(GradingScale).where(GradingScale.is_active.is_(True))):
        old.is_active = False
    scale = GradingScale(name=body.name, is_active=True)
    for e in body.entries:
        scale.entries.append(GradeEntry(**e.model_dump()))
    db.add(scale)
    db.flush()
    entries = active_entries(db)
    # Published results keep the grade they were published with; everything else is recalculated.
    open_results = db.scalars(select(Result).where(Result.status != "PUBLISHED")).all()
    for r in open_results:
        apply_scores(entries, school, r, r.ca_score, r.exam_score)
    audit(db, request, user, "GRADING_SCALE_UPDATE", "grading_scale", scale.id, {"recalculated": len(open_results)})
    db.commit()
    return scale_dict(db)
