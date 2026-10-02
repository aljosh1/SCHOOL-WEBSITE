from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Always returns timezone-aware UTC datetimes (SQLite drops tzinfo)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------- identity


class User(Base, Timestamps):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    teacher: Mapped["Teacher | None"] = relationship(back_populates="user", uselist=False)
    student: Mapped["Student | None"] = relationship(back_populates="user", uselist=False)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role", "permission"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    permission: Mapped[str] = mapped_column(String(60))


class Teacher(Base, Timestamps):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    staff_no: Mapped[str] = mapped_column(String(30), unique=True)
    qualification: Mapped[str | None] = mapped_column(String(200))
    bio: Mapped[str | None] = mapped_column(Text)
    show_on_website: Mapped[bool] = mapped_column(Boolean, default=True)
    public_title: Mapped[str | None] = mapped_column(String(120))

    user: Mapped[User] = relationship(back_populates="teacher")
    assignments: Mapped[list["TeachingAssignment"]] = relationship(
        back_populates="teacher", cascade="all, delete-orphan"
    )


class Parent(Base, Timestamps):
    __tablename__ = "parents"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200))
    relationship_type: Mapped[str | None] = mapped_column(String(40))
    phone: Mapped[str | None] = mapped_column(String(30), index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    occupation: Mapped[str | None] = mapped_column(String(120))


class Student(Base, Timestamps):
    __tablename__ = "students"
    __table_args__ = (Index("ix_students_names", "last_name", "first_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_no: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    admission_no: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("parents.id", ondelete="SET NULL"), index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    middle_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(10))
    photo_key: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    state_of_origin: Mapped[str | None] = mapped_column(String(60))
    religion: Mapped[str | None] = mapped_column(String(40))
    blood_group: Mapped[str | None] = mapped_column(String(5))
    medical_notes: Mapped[str | None] = mapped_column(Text)
    previous_school: Mapped[str | None] = mapped_column(String(200))
    admission_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    emergency_name: Mapped[str | None] = mapped_column(String(200))
    emergency_phone: Mapped[str | None] = mapped_column(String(30))
    emergency_relationship: Mapped[str | None] = mapped_column(String(60))

    user: Mapped[User | None] = relationship(back_populates="student")
    parent: Mapped[Parent | None] = relationship()
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="student")

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)


# ---------------------------------------------------------------- academics


class AcademicSession(Base, Timestamps):
    __tablename__ = "academic_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(20), unique=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    terms: Mapped[list["Term"]] = relationship(back_populates="session", order_by="Term.position")


class Term(Base, Timestamps):
    __tablename__ = "terms"
    __table_args__ = (UniqueConstraint("session_id", "position"), UniqueConstraint("session_id", "name"))

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    position: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    next_term_begins: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[AcademicSession] = relationship(back_populates="terms")


class SchoolClass(Base, Timestamps):
    __tablename__ = "school_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    level_order: Mapped[int] = mapped_column(Integer, default=0, index=True)

    arms: Mapped[list["ClassArm"]] = relationship(
        back_populates="school_class", cascade="all, delete-orphan", order_by="ClassArm.name"
    )


class ClassArm(Base, Timestamps):
    __tablename__ = "class_arms"
    __table_args__ = (UniqueConstraint("class_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(20))
    form_teacher_id: Mapped[int | None] = mapped_column(ForeignKey("teachers.id", ondelete="SET NULL"))

    school_class: Mapped[SchoolClass] = relationship(back_populates="arms")
    form_teacher: Mapped[Teacher | None] = relationship()


class Subject(Base, Timestamps):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    category: Mapped[str | None] = mapped_column(String(40))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Enrollment(Base, Timestamps):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("student_id", "session_id"),
        Index("ix_enroll_class", "session_id", "class_id", "arm_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id"), index=True)
    arm_id: Mapped[int | None] = mapped_column(ForeignKey("class_arms.id"))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")

    student: Mapped[Student] = relationship(back_populates="enrollments")
    session: Mapped[AcademicSession] = relationship()
    school_class: Mapped[SchoolClass] = relationship()
    arm: Mapped[ClassArm | None] = relationship()


class TeachingAssignment(Base):
    __tablename__ = "teaching_assignments"
    __table_args__ = (UniqueConstraint("teacher_id", "session_id", "class_id", "arm_id", "subject_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    arm_id: Mapped[int | None] = mapped_column(ForeignKey("class_arms.id", ondelete="CASCADE"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)

    teacher: Mapped[Teacher] = relationship(back_populates="assignments")
    session: Mapped[AcademicSession] = relationship()
    school_class: Mapped[SchoolClass] = relationship()
    arm: Mapped[ClassArm | None] = relationship()
    subject: Mapped[Subject] = relationship()


class GradingScale(Base, Timestamps):
    __tablename__ = "grading_scales"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    entries: Mapped[list["GradeEntry"]] = relationship(
        back_populates="scale", cascade="all, delete-orphan", order_by="GradeEntry.min_score.desc()"
    )


class GradeEntry(Base):
    __tablename__ = "grade_entries"
    __table_args__ = (CheckConstraint("min_score <= max_score", name="ck_grade_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    scale_id: Mapped[int] = mapped_column(ForeignKey("grading_scales.id", ondelete="CASCADE"), index=True)
    grade: Mapped[str] = mapped_column(String(5))
    description: Mapped[str] = mapped_column(String(60))
    min_score: Mapped[float] = mapped_column(Float)
    max_score: Mapped[float] = mapped_column(Float)
    grade_point: Mapped[float] = mapped_column(Float, default=0)
    remark: Mapped[str | None] = mapped_column(String(300))
    principal_remark: Mapped[str | None] = mapped_column(String(300))

    scale: Mapped[GradingScale] = relationship(back_populates="entries")


# ---------------------------------------------------------------- results


class Result(Base, Timestamps):
    __tablename__ = "results"
    __table_args__ = (
        UniqueConstraint("enrollment_id", "subject_id", "term_id"),
        CheckConstraint("ca_score >= 0 AND exam_score >= 0", name="ck_scores_nonneg"),
        Index("ix_results_term_status", "term_id", "status"),
        Index("ix_results_subject_term", "subject_id", "term_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    enrollment_id: Mapped[int] = mapped_column(ForeignKey("enrollments.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id"))
    ca_score: Mapped[float] = mapped_column(Float, default=0)
    exam_score: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float, default=0)
    grade: Mapped[str | None] = mapped_column(String(5))
    grade_description: Mapped[str | None] = mapped_column(String(60))
    grade_point: Mapped[float | None] = mapped_column(Float)
    teacher_remark: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    entered_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    published_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    rejection_reason: Mapped[str | None] = mapped_column(String(300))

    enrollment: Mapped[Enrollment] = relationship()
    subject: Mapped[Subject] = relationship()
    term: Mapped[Term] = relationship()


class ResultAmendment(Base, Timestamps):
    __tablename__ = "result_amendments"

    id: Mapped[int] = mapped_column(primary_key=True)
    result_id: Mapped[int] = mapped_column(ForeignKey("results.id", ondelete="CASCADE"), index=True)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    old_ca: Mapped[float] = mapped_column(Float)
    old_exam: Mapped[float] = mapped_column(Float)
    new_ca: Mapped[float] = mapped_column(Float)
    new_exam: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(10), default="PENDING", index=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    decision_note: Mapped[str | None] = mapped_column(String(300))

    result: Mapped[Result] = relationship()
    requested_by: Mapped[User | None] = relationship(foreign_keys=[requested_by_id])


class ReportCard(Base, Timestamps):
    __tablename__ = "report_cards"
    __table_args__ = (UniqueConstraint("enrollment_id", "term_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    enrollment_id: Mapped[int] = mapped_column(ForeignKey("enrollments.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id"), index=True)
    verification_ref: Mapped[str] = mapped_column(String(20), unique=True)
    teacher_remark: Mapped[str | None] = mapped_column(String(400))
    principal_remark: Mapped[str | None] = mapped_column(String(400))
    first_published_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    enrollment: Mapped[Enrollment] = relationship()
    term: Mapped[Term] = relationship()


# ---------------------------------------------------------------- result codes


class ResultAccessCode(Base, Timestamps):
    __tablename__ = "result_access_codes"
    __table_args__ = (CheckConstraint("use_count >= 0 AND max_uses >= 1", name="ck_code_uses"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    serial: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    code_last4: Mapped[str] = mapped_column(String(4))
    batch_ref: Mapped[str | None] = mapped_column(String(30), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id"), index=True)
    term_id: Mapped[int | None] = mapped_column(ForeignKey("terms.id"))
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), index=True)
    max_uses: Mapped[int] = mapped_column(Integer, default=5)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    first_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    session: Mapped[AcademicSession] = relationship()
    term: Mapped[Term | None] = relationship()
    student: Mapped[Student | None] = relationship()


class ResultAccessLog(Base):
    __tablename__ = "result_access_logs"
    __table_args__ = (Index("ix_access_ip_time", "ip", "created_at"), Index("ix_access_ref_time", "ref", "created_at"))

    id: Mapped[int] = mapped_column(primary_key=True)
    code_id: Mapped[int | None] = mapped_column(ForeignKey("result_access_codes.id", ondelete="SET NULL"), index=True)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))
    report_card_id: Mapped[int | None] = mapped_column(ForeignKey("report_cards.id", ondelete="SET NULL"))
    ref: Mapped[str | None] = mapped_column(String(60))  # normalised student reference as typed
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(String(40))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


# ---------------------------------------------------------------- content


class LearningMaterial(Base, Timestamps):
    __tablename__ = "learning_materials"
    __table_args__ = (Index("ix_materials_scope", "class_id", "subject_id", "visibility"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id"))
    teacher_id: Mapped[int | None] = mapped_column(ForeignKey("teachers.id", ondelete="SET NULL"))
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id"))
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id"))
    file_key: Mapped[str | None] = mapped_column(String(255))
    file_name: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    text_content: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(12), default="DRAFT")

    subject: Mapped[Subject] = relationship()
    school_class: Mapped[SchoolClass] = relationship()
    teacher: Mapped[Teacher | None] = relationship()
    session: Mapped[AcademicSession] = relationship()
    term: Mapped[Term] = relationship()


class Announcement(Base, Timestamps):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30), default="NEWS")
    image_key: Mapped[str | None] = mapped_column(String(255))
    event_date: Mapped[date | None] = mapped_column(Date)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), default="DRAFT", index=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)

    author: Mapped[User | None] = relationship()


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notif_user_read", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(String(500))
    link: Mapped[str | None] = mapped_column(String(200))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    username: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    detail: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class AdmissionApplication(Base, Timestamps):
    __tablename__ = "admission_applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(20), unique=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    middle_name: Mapped[str | None] = mapped_column(String(100))
    date_of_birth: Mapped[date] = mapped_column(Date)
    gender: Mapped[str] = mapped_column(String(10))
    class_applied_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id"))
    previous_school: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(Text)
    state_of_origin: Mapped[str | None] = mapped_column(String(60))
    medical_notes: Mapped[str | None] = mapped_column(Text)
    guardian_name: Mapped[str] = mapped_column(String(200))
    guardian_relationship: Mapped[str | None] = mapped_column(String(40))
    guardian_phone: Mapped[str] = mapped_column(String(30))
    guardian_email: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(15), default="PENDING", index=True)
    review_note: Mapped[str | None] = mapped_column(String(500))
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))

    class_applied: Mapped[SchoolClass] = relationship()


class Backup(Base):
    __tablename__ = "backups"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_key: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class SchoolSettings(Base, Timestamps):
    __tablename__ = "school_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="Your School Name")
    short_name: Mapped[str] = mapped_column(String(40), default="SCH")
    motto: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(255))
    facebook: Mapped[str | None] = mapped_column(String(255))
    instagram: Mapped[str | None] = mapped_column(String(255))
    twitter: Mapped[str | None] = mapped_column(String(255))
    youtube: Mapped[str | None] = mapped_column(String(255))
    map_embed_url: Mapped[str | None] = mapped_column(String(600))
    primary_color: Mapped[str] = mapped_column(String(9), default="#14532d")
    secondary_color: Mapped[str] = mapped_column(String(9), default="#b45309")
    logo_key: Mapped[str | None] = mapped_column(String(255))
    stamp_key: Mapped[str | None] = mapped_column(String(255))
    signature_key: Mapped[str | None] = mapped_column(String(255))
    hero_key: Mapped[str | None] = mapped_column(String(255))
    principal_name: Mapped[str | None] = mapped_column(String(200))
    principal_title: Mapped[str | None] = mapped_column(String(100), default="Principal")
    principal_message: Mapped[str | None] = mapped_column(Text)
    history: Mapped[str | None] = mapped_column(Text)
    vision: Mapped[str | None] = mapped_column(Text)
    mission: Mapped[str | None] = mapped_column(Text)
    philosophy: Mapped[str | None] = mapped_column(Text)
    core_values: Mapped[list | None] = mapped_column(JSON)
    ca_max: Mapped[float] = mapped_column(Float, default=40)
    exam_max: Mapped[float] = mapped_column(Float, default=60)
    require_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_teacher_self_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    show_position: Mapped[bool] = mapped_column(Boolean, default=True)
    code_prefix: Mapped[str] = mapped_column(String(6), default="SCH")
    code_default_max_uses: Mapped[int] = mapped_column(Integer, default=5)
    code_default_expiry_days: Mapped[int] = mapped_column(Integer, default=0)
    result_footer_note: Mapped[str | None] = mapped_column(String(300))
