import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints, field_validator, model_validator

Str = Annotated[str, StringConstraints(strip_whitespace=True)]
_NG_PHONE = re.compile(r"^(?:\+?234|0)[789][01]\d{8}$")


def _phone(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    cleaned = re.sub(r"[\s\-()]", "", v)
    if not _NG_PHONE.match(cleaned):
        raise ValueError("Enter a valid Nigerian phone number, e.g. 08031234567")
    return cleaned


Phone = Annotated[str | None, AfterValidator(_phone)]
Gender = Literal["MALE", "FEMALE"]


class Page(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=200)


# ------------------------------------------------------------------ auth/users


class LoginIn(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: Annotated[str, StringConstraints(min_length=8, max_length=128)]


class ForgotPasswordIn(BaseModel):
    identifier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=255)]


class ResetPasswordIn(BaseModel):
    token: Annotated[str, StringConstraints(min_length=20, max_length=100)]
    new_password: Annotated[str, StringConstraints(min_length=8, max_length=128)]


class UserCreate(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._@-]+$")]
    email: EmailStr | None = None
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
    phone: Phone = None
    role: Literal["ADMIN", "TEACHER", "SUPER_ADMIN"]
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)] | None = None


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)] | None = None
    phone: Phone = None


# ------------------------------------------------------------------ students


class StudentIn(BaseModel):
    first_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    middle_name: Str | None = Field(None, max_length=100)
    last_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    date_of_birth: date | None = None
    gender: Gender | None = None
    address: Str | None = None
    state_of_origin: Str | None = Field(None, max_length=60)
    religion: Str | None = Field(None, max_length=40)
    blood_group: Str | None = Field(None, max_length=5)
    medical_notes: Str | None = None
    previous_school: Str | None = Field(None, max_length=200)
    admission_no: Str | None = Field(None, max_length=40)
    admission_date: date | None = None
    status: Literal["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"] | None = None
    emergency_name: Str | None = Field(None, max_length=200)
    emergency_phone: Phone = None
    emergency_relationship: Str | None = Field(None, max_length=60)
    parent_name: Str | None = Field(None, max_length=200)
    parent_relationship: Str | None = Field(None, max_length=40)
    parent_phone: Phone = None
    parent_email: EmailStr | None = None
    parent_address: Str | None = None
    parent_occupation: Str | None = Field(None, max_length=120)
    class_id: int | None = None
    arm_id: int | None = None
    session_id: int | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: date | None) -> date | None:
        if v and (v >= date.today() or v.year < 1980):
            raise ValueError("Date of birth is not valid")
        return v


class PromoteIn(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=500)
    to_session_id: int
    to_class_id: int | None = None
    to_arm_id: int | None = None
    graduate: bool = False


# ------------------------------------------------------------------ teachers


class TeacherIn(BaseModel):
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._@-]+$")] | None = None
    email: EmailStr | None = None
    phone: Phone = None
    staff_no: Str | None = Field(None, max_length=30)
    qualification: Str | None = Field(None, max_length=200)
    bio: Str | None = None
    show_on_website: bool = True
    public_title: Str | None = Field(None, max_length=120)
    is_active: bool | None = None


class AssignmentItem(BaseModel):
    class_id: int
    arm_id: int | None = None
    subject_id: int


class AssignmentsIn(BaseModel):
    session_id: int
    items: list[AssignmentItem] = Field(max_length=200)


# ------------------------------------------------------------------ academics


class SessionIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{4}/\d{4}$")]
    start_date: date | None = None
    end_date: date | None = None
    create_default_terms: bool = True

    @model_validator(mode="after")
    def _years(self):
        a, b = self.name.split("/")
        if int(b) != int(a) + 1:
            raise ValueError("Session must span consecutive years, e.g. 2026/2027")
        return self


class TermIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40)]
    position: int = Field(ge=1, le=6)
    start_date: date | None = None
    end_date: date | None = None
    next_term_begins: date | None = None


class ClassIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    level_order: int = Field(0, ge=0, le=100)


class ArmIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    form_teacher_id: int | None = None


class SubjectIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=20, to_upper=True)]
    category: Str | None = Field(None, max_length=40)
    is_active: bool = True


class GradeEntryIn(BaseModel):
    grade: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    min_score: float = Field(ge=0)
    max_score: float = Field(ge=0)
    grade_point: float = Field(0, ge=0, le=10)
    remark: Str | None = Field(None, max_length=300)
    principal_remark: Str | None = Field(None, max_length=300)

    @model_validator(mode="after")
    def _range(self):
        if self.min_score > self.max_score:
            raise ValueError("min_score cannot exceed max_score")
        return self


class GradingScaleIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] = "Default"
    entries: list[GradeEntryIn] = Field(min_length=2, max_length=15)


# ------------------------------------------------------------------ results


class ResultCreate(BaseModel):
    enrollment_id: int
    subject_id: int
    term_id: int
    ca_score: float = Field(0, ge=0)
    exam_score: float = Field(0, ge=0)
    teacher_remark: Str | None = Field(None, max_length=300)


class ResultUpdate(BaseModel):
    ca_score: float | None = Field(None, ge=0)
    exam_score: float | None = Field(None, ge=0)
    teacher_remark: Str | None = Field(None, max_length=300)


class BulkLine(BaseModel):
    enrollment_id: int
    ca_score: float | None = Field(None, ge=0)
    exam_score: float | None = Field(None, ge=0)
    teacher_remark: Str | None = Field(None, max_length=300)


class BulkResultsIn(BaseModel):
    subject_id: int
    term_id: int
    lines: list[BulkLine] = Field(min_length=1, max_length=500)


class BatchActionIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    reason: Str | None = Field(None, max_length=300)


class AmendmentIn(BaseModel):
    ca_score: float = Field(ge=0)
    exam_score: float = Field(ge=0)
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]


class DecisionIn(BaseModel):
    note: Str | None = Field(None, max_length=300)


class RemarksIn(BaseModel):
    teacher_remark: Str | None = Field(None, max_length=400)
    principal_remark: Str | None = Field(None, max_length=400)


# ------------------------------------------------------------------ codes


class CodeGenerateIn(BaseModel):
    quantity: int = Field(1, ge=1, le=1000)
    session_id: int
    term_id: int | None = None
    student_id: int | None = None
    max_uses: int | None = Field(None, ge=1, le=100)
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def _single_student(self):
        if self.student_id is not None and self.quantity != 1:
            raise ValueError("A code assigned to a student must be generated one at a time")
        return self


class CodeUpdateIn(BaseModel):
    is_active: bool | None = None
    max_uses: int | None = Field(None, ge=1, le=100)
    expires_at: datetime | None = None
    clear_expiry: bool = False
    student_id: int | None = None
    clear_student: bool = False


class CardsPdfIn(BaseModel):
    cards: list[dict[str, str]] = Field(min_length=1, max_length=200)


class ResultCheckIn(BaseModel):
    student_ref: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=40)]
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=40)]
    session_id: int
    term_id: int


# ------------------------------------------------------------------ content


class MaterialUpdate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)] | None = None
    description: Str | None = None
    visibility: Literal["DRAFT", "PUBLISHED", "ARCHIVED"] | None = None
    text_content: Str | None = None


class AnnouncementIn(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=20000)]
    category: Literal["NEWS", "EXAM", "HOLIDAY", "EVENT", "ADMISSION", "PARENT_NOTICE", "ACADEMIC"] = "NEWS"
    event_date: date | None = None
    status: Literal["DRAFT", "PUBLISHED"] = "DRAFT"
    expires_at: datetime | None = None
    is_public: bool = True


class ApplicationIn(BaseModel):
    first_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    middle_name: Str | None = Field(None, max_length=100)
    last_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    date_of_birth: date
    gender: Gender
    class_applied_id: int
    previous_school: Str | None = Field(None, max_length=200)
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    state_of_origin: Str | None = Field(None, max_length=60)
    medical_notes: Str | None = Field(None, max_length=1000)
    guardian_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
    guardian_relationship: Str | None = Field(None, max_length=40)
    guardian_phone: Annotated[str, AfterValidator(lambda v: _phone(v) or "")]
    guardian_email: EmailStr | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: date) -> date:
        if v >= date.today() or v.year < 1990:
            raise ValueError("Date of birth is not valid")
        return v


class ApplicationReviewIn(BaseModel):
    status: Literal["UNDER_REVIEW", "ACCEPTED", "REJECTED"]
    review_note: Str | None = Field(None, max_length=500)


class SettingsIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)] | None = None
    short_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)] | None = None
    motto: Str | None = Field(None, max_length=200)
    address: Str | None = None
    phone: Str | None = Field(None, max_length=60)
    email: EmailStr | None = None
    website: Str | None = Field(None, max_length=255)
    facebook: Str | None = Field(None, max_length=255)
    instagram: Str | None = Field(None, max_length=255)
    twitter: Str | None = Field(None, max_length=255)
    youtube: Str | None = Field(None, max_length=255)
    map_embed_url: Str | None = Field(None, max_length=600)
    primary_color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")] | None = None
    secondary_color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")] | None = None
    principal_name: Str | None = Field(None, max_length=200)
    principal_title: Str | None = Field(None, max_length=100)
    principal_message: Str | None = None
    history: Str | None = None
    vision: Str | None = None
    mission: Str | None = None
    philosophy: Str | None = None
    core_values: list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]] | None = Field(None, max_length=12)
    ca_max: float | None = Field(None, gt=0, le=100)
    exam_max: float | None = Field(None, gt=0, le=100)
    require_approval: bool | None = None
    allow_teacher_self_approval: bool | None = None
    show_position: bool | None = None
    code_prefix: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Z]{2,6}$")] | None = None
    code_default_max_uses: int | None = Field(None, ge=1, le=100)
    code_default_expiry_days: int | None = Field(None, ge=0, le=3650)
    result_footer_note: Str | None = Field(None, max_length=300)

    @field_validator("map_embed_url")
    @classmethod
    def _map(cls, v: str | None) -> str | None:
        if v and not v.startswith("https://www.google.com/maps/embed"):
            raise ValueError("Use the Google Maps 'Embed a map' URL (https://www.google.com/maps/embed?...)")
        return v

    @field_validator("facebook", "instagram", "twitter", "youtube", "website")
    @classmethod
    def _urls(cls, v: str | None) -> str | None:
        if v and not re.match(r"^https?://", v):
            raise ValueError("Must start with http:// or https://")
        return v


class PermissionsIn(BaseModel):
    matrix: dict[Literal["ADMIN", "TEACHER", "STUDENT"], list[str]]
