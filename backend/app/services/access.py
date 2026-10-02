from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import (
    AcademicSession,
    ClassArm,
    Enrollment,
    SchoolSettings,
    Student,
    Teacher,
    TeachingAssignment,
    Term,
    User,
)


def get_school(db: Session) -> SchoolSettings:
    s = db.scalars(select(SchoolSettings).limit(1)).first()
    if not s:
        s = SchoolSettings()
        db.add(s)
        db.flush()
    return s


def current_session(db: Session) -> AcademicSession | None:
    return db.scalars(select(AcademicSession).where(AcademicSession.is_current.is_(True))).first() or db.scalars(
        select(AcademicSession).order_by(AcademicSession.name.desc())
    ).first()


def current_term(db: Session, session_id: int | None = None) -> Term | None:
    q = select(Term).where(Term.is_current.is_(True))
    if session_id:
        q = q.where(Term.session_id == session_id)
    return db.scalars(q).first()


def teacher_for(db: Session, user: User) -> Teacher | None:
    return db.scalars(select(Teacher).where(Teacher.user_id == user.id)).first()


def student_for(db: Session, user: User) -> Student | None:
    return db.scalars(select(Student).where(Student.user_id == user.id)).first()


def assignments_for(db: Session, teacher_id: int, session_id: int) -> list[TeachingAssignment]:
    return list(
        db.scalars(
            select(TeachingAssignment).where(
                TeachingAssignment.teacher_id == teacher_id, TeachingAssignment.session_id == session_id
            )
        )
    )


def can_teach(assignments: list[TeachingAssignment], class_id: int, arm_id: int | None, subject_id: int) -> bool:
    return any(
        a.class_id == class_id and a.subject_id == subject_id and (a.arm_id is None or a.arm_id == arm_id)
        for a in assignments
    )


def form_arm_ids(db: Session, teacher_id: int) -> list[int]:
    return list(db.scalars(select(ClassArm.id).where(ClassArm.form_teacher_id == teacher_id)))


def enrollment_scope_clause(db: Session, teacher: Teacher, session_id: int):
    """SQL condition limiting enrollments to those a teacher teaches or is form teacher of."""
    conds = []
    for a in assignments_for(db, teacher.id, session_id):
        if a.arm_id is None:
            conds.append(Enrollment.class_id == a.class_id)
        else:
            conds.append(and_(Enrollment.class_id == a.class_id, Enrollment.arm_id == a.arm_id))
    arms = form_arm_ids(db, teacher.id)
    if arms:
        conds.append(Enrollment.arm_id.in_(arms))
    return or_(*conds) if conds else Enrollment.id == -1


def teacher_can_see_student(db: Session, teacher: Teacher, student_id: int) -> bool:
    sess = current_session(db)
    if not sess:
        return False
    q = select(Enrollment.id).where(
        Enrollment.student_id == student_id,
        Enrollment.session_id == sess.id,
        enrollment_scope_clause(db, teacher, sess.id),
    )
    return db.scalars(q.limit(1)).first() is not None


def current_enrollment(db: Session, student_id: int, session_id: int | None = None) -> Enrollment | None:
    if session_id is None:
        sess = current_session(db)
        session_id = sess.id if sess else None
    if session_id is None:
        return None
    return db.scalars(
        select(Enrollment).where(Enrollment.student_id == student_id, Enrollment.session_id == session_id)
    ).first()


def latest_enrollment(db: Session, student_id: int) -> Enrollment | None:
    return db.scalars(
        select(Enrollment)
        .join(AcademicSession, AcademicSession.id == Enrollment.session_id)
        .where(Enrollment.student_id == student_id)
        .order_by(AcademicSession.name.desc())
        .limit(1)
    ).first()
