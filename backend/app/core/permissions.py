"""Permission keys and the default role -> permission map.

SUPER_ADMIN always holds every permission. Overrides for the other roles live in
the `role_permissions` table and are editable by SUPER_ADMIN.
"""
import enum


class Role(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"


PERMISSIONS: dict[str, str] = {
    "users.manage_admins": "Create and manage administrator accounts",
    "users.manage": "Create and manage teacher/student accounts",
    "students.read": "View students",
    "students.write": "Register, edit, promote and deactivate students",
    "teachers.read": "View teachers",
    "teachers.write": "Create and edit teachers and their assignments",
    "academics.read": "View sessions, terms, classes, subjects",
    "academics.write": "Manage sessions, terms, classes, subjects, grading",
    "results.read": "View results in scope",
    "results.write": "Enter and edit draft results",
    "results.submit": "Submit results for approval",
    "results.approve": "Approve, reject and publish results",
    "results.amend": "Request amendments to published results",
    "results.amend_approve": "Approve amendments to published results",
    "codes.manage": "Generate and manage result access codes",
    "materials.read": "Browse learning materials",
    "materials.write": "Upload and manage learning materials",
    "announcements.write": "Publish announcements",
    "admissions.manage": "Review admission applications",
    "audit.read": "View the audit log",
    "settings.manage": "Configure school settings",
    "reports.read": "View reports",
    "backups.manage": "Manage backups",
    "permissions.manage": "Manage the role permission matrix",
}

ALL = set(PERMISSIONS)

DEFAULTS: dict[str, set[str]] = {
    Role.SUPER_ADMIN.value: ALL,
    Role.ADMIN.value: ALL - {"users.manage_admins", "backups.manage", "permissions.manage"},
    Role.TEACHER.value: {
        "students.read",
        "teachers.read",
        "academics.read",
        "results.read",
        "results.write",
        "results.submit",
        "results.amend",
        "materials.read",
        "materials.write",
        "reports.read",
    },
    Role.STUDENT.value: {"materials.read"},
}

# Only these roles can be edited through the permission matrix.
EDITABLE_ROLES = (Role.ADMIN.value, Role.TEACHER.value, Role.STUDENT.value)
# Student permissions beyond these are meaningless/dangerous; keep the matrix honest.
STUDENT_ALLOWED = {"materials.read"}
