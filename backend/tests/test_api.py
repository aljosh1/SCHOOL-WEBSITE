import io

import pytest
from sqlalchemy import select

from app.core.db import SessionLocal
from app.create_admin import create_first_super_admin
from app.models import AuditLog, ResultAccessCode, User
from tests.conftest import PASSWORD, login


# ------------------------------------------------------------------ auth


def test_login_failure_is_generic_and_locks(client):
    for _ in range(5):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Incorrect username or password"
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 429
    r = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401 and r.json()["detail"] == "Incorrect username or password"


def test_protected_routes_need_token(client):
    assert client.get("/api/students").status_code == 401
    assert client.get("/api/settings").status_code == 401


def test_passwords_are_hashed(client, admin):
    with SessionLocal() as db:
        u = db.scalars(select(User).where(User.username == "admin")).one()
        assert u.password_hash.startswith("$argon2") and PASSWORD not in u.password_hash


def test_first_super_admin_bootstrap_requires_empty_users_table():
    with SessionLocal() as db:
        with pytest.raises(RuntimeError, match="users table is not empty"):
            create_first_super_admin(db, "first-admin", "First Admin", "StrongPass123")


def test_first_super_admin_bootstrap_creates_login(client):
    with SessionLocal() as db:
        db.query(User).delete()
        db.commit()
        user = create_first_super_admin(db, "first-admin", "First Admin", "StrongPass123")
        assert user.role == "SUPER_ADMIN"
        assert user.is_demo is False

    response = client.post("/api/auth/login", json={"username": "first-admin", "password": "StrongPass123"})
    assert response.status_code == 200


def test_role_permissions(client, admin, superadmin, school):
    teacher = login(client, "ada")
    student = login(client, school["students"][0]["student_no"])
    assert client.get("/api/settings", headers=teacher).status_code == 403
    assert client.get("/api/users", headers=teacher).status_code == 403
    assert client.get("/api/audit-logs", headers=teacher).status_code == 403
    assert client.post("/api/teachers", json={"full_name": "X Y"}, headers=teacher).status_code == 403
    assert client.get("/api/students", headers=student).status_code == 403
    assert client.get("/api/result-codes", headers=teacher).status_code == 403
    # admins cannot create admins or manage backups; super admin can
    body = {"username": "newadmin", "full_name": "New Admin", "role": "ADMIN"}
    assert client.post("/api/auth/register", json=body, headers=admin).status_code == 403
    assert client.post("/api/auth/register", json=body, headers=superadmin).status_code == 201
    assert client.get("/api/backups", headers=admin).status_code == 403
    assert client.post("/api/backups", headers=superadmin).status_code == 201


def test_permission_matrix_is_editable_by_super_admin(client, admin, superadmin):
    assert client.get("/api/permissions", headers=admin).status_code == 403
    m = client.get("/api/permissions", headers=superadmin).json()["matrix"]
    m["ADMIN"].remove("audit.read")
    r = client.put("/api/permissions", json={"matrix": {"ADMIN": m["ADMIN"]}}, headers=superadmin)
    assert r.status_code == 200
    assert client.get("/api/audit-logs", headers=admin).status_code == 403


# ------------------------------------------------------------------ students


def test_student_registration_and_scoping(client, admin, school):
    s = school["students"][0]
    assert s["student_no"].startswith("STU-2026-") and s["admission_no"].startswith("ADM-2026-")
    assert s["credentials"]["username"] == s["student_no"]
    lst = client.get("/api/students", params={"q": "chidi"}, headers=admin).json()
    assert lst["total"] == 1
    teacher = login(client, "ada")
    assert client.get("/api/students", headers=teacher).json()["total"] == 2
    # student can read own profile but not another student's
    st = login(client, s["student_no"])
    assert client.get(f"/api/students/{s['id']}", headers=st).status_code == 200
    assert client.get(f"/api/students/{school['students'][1]['id']}", headers=st).status_code == 404


def test_csv_export_neutralises_formulas(client, admin, school):
    client.put(f"/api/students/{school['students'][0]['id']}", json={"first_name": "=HYPERLINK(1)", "last_name": "Okoro"}, headers=admin)
    r = client.get("/api/students/export.csv", headers=admin)
    assert r.status_code == 200 and "'=HYPERLINK(1)" in r.text


def test_phone_validation(client, admin, school):
    r = client.post("/api/students", json={"first_name": "A", "last_name": "B", "parent_phone": "12345"}, headers=admin)
    assert r.status_code == 422


def test_photo_upload_validation(client, admin, school):
    sid = school["students"][0]["id"]
    bad = client.post(f"/api/students/{sid}/photo", files={"file": ("x.jpg", b"not an image", "image/jpeg")}, headers=admin)
    assert bad.status_code == 422
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (50, 50), "red").save(buf, "JPEG")
    ok = client.post(f"/api/students/{sid}/photo", files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")}, headers=admin)
    assert ok.status_code == 200
    assert client.get(f"/api/students/{sid}/photo").status_code == 401
    assert client.get(f"/api/students/{sid}/photo", headers=admin).status_code == 200


def test_promotion(client, admin, school):
    nxt = client.post("/api/sessions", json={"name": "2027/2028"}, headers=admin).json()
    k2 = client.post("/api/classes", json={"name": "JSS 2", "level_order": 2}, headers=admin).json()
    r = client.post("/api/students/promote", json={"student_ids": [s["id"] for s in school["students"]], "to_session_id": nxt["id"], "to_class_id": k2["id"]}, headers=admin)
    assert r.json()["promoted"] == 2
    again = client.post("/api/students/promote", json={"student_ids": [school["students"][0]["id"]], "to_session_id": nxt["id"], "to_class_id": k2["id"]}, headers=admin)
    assert again.json()["promoted"] == 0 and again.json()["skipped"]


# ------------------------------------------------------------------ results workflow


def _enroll_ids(client, admin, school):
    sheet = client.get("/api/results/sheet", params={"class_id": school["class"]["id"], "arm_id": school["arm"]["id"], "subject_id": school["maths"]["id"], "term_id": school["term"]["id"]}, headers=admin).json()
    by_student = {r["student_id"]: r["enrollment_id"] for r in sheet["rows"]}
    return sheet, [by_student[s["id"]] for s in school["students"]]


def test_result_calculation_and_workflow(client, admin, school):
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    payload = {"subject_id": school["maths"]["id"], "term_id": school["term"]["id"],
               "lines": [{"enrollment_id": eids[0], "ca_score": 35, "exam_score": 50}, {"enrollment_id": eids[1], "ca_score": 10, "exam_score": 20}]}
    r = client.post("/api/results/bulk", json=payload, headers=teacher)
    assert r.status_code == 200 and r.json()["saved"] == 2
    rows = client.get("/api/results", params={"term_id": school["term"]["id"]}, headers=teacher).json()["items"]
    by = {x["enrollment_id"]: x for x in rows}
    assert by[eids[0]]["total"] == 85 and by[eids[0]]["grade"] == "A" and by[eids[0]]["grade_description"] == "Excellent"
    assert by[eids[1]]["total"] == 30 and by[eids[1]]["grade"] == "F"
    rid = by[eids[0]]["id"]

    # scores above the maximum are rejected
    bad = client.put(f"/api/results/{rid}", json={"ca_score": 41}, headers=teacher)
    assert bad.status_code == 422

    # draft not visible to the student
    st = login(client, school["students"][0]["student_no"])
    assert client.get("/api/results/history", headers=st).json() == []

    assert client.post(f"/api/results/{rid}/approve", headers=teacher).status_code == 403   # teacher cannot approve
    assert client.post(f"/api/results/{rid}/publish", headers=admin).status_code == 409     # must be submitted + approved first
    assert client.post(f"/api/results/{rid}/submit", headers=teacher).status_code == 200
    assert client.put(f"/api/results/{rid}", json={"ca_score": 30}, headers=teacher).status_code == 409  # submitted = locked
    assert client.post(f"/api/results/{rid}/publish", headers=admin).status_code == 409     # approval required first
    assert client.post(f"/api/results/{rid}/approve", headers=admin).status_code == 200
    assert client.post(f"/api/results/{rid}/publish", headers=admin).status_code == 200

    hist = client.get("/api/results/history", headers=st).json()
    assert hist[0]["terms"][0]["average"] == 85
    card_id = hist[0]["terms"][0]["card_id"]
    rep = client.get(f"/api/report-cards/{card_id}", headers=st).json()
    assert rep["subjects"][0]["total"] == 85 and rep["summary"]["position_label"] == "1st"
    # another student cannot open this card by changing the id
    other = login(client, school["students"][1]["student_no"])
    assert client.get(f"/api/report-cards/{card_id}", headers=other).status_code == 404
    assert client.get(f"/api/report-cards/{card_id}/pdf", headers=other).status_code == 404
    pdf = client.get(f"/api/report-cards/{card_id}/pdf", headers=st)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    # published result cannot be silently edited; amendment is controlled + audited
    assert client.put(f"/api/results/{rid}", json={"ca_score": 30}, headers=admin).status_code == 409
    am = client.post(f"/api/results/{rid}/amendments", json={"ca_score": 30, "exam_score": 50, "reason": "Marking error"}, headers=teacher)
    assert am.status_code == 201 and am.json()["status"] == "PENDING"
    assert client.post(f"/api/amendments/{am.json()['id']}/approve", json={}, headers=teacher).status_code == 403
    assert client.post(f"/api/amendments/{am.json()['id']}/approve", json={}, headers=admin).status_code == 200
    rows = client.get("/api/results", params={"term_id": school["term"]["id"]}, headers=admin).json()["items"]
    assert {x["id"]: x for x in rows}[rid]["total"] == 80
    with SessionLocal() as db:
        actions = {a.action for a in db.scalars(select(AuditLog))}
    assert {"RESULT_SUBMIT", "RESULT_APPROVE", "RESULT_PUBLISH", "RESULT_AMEND_REQUEST", "RESULT_AMEND_APPLY"} <= actions


def test_teacher_can_only_enter_assigned_results(client, admin, school):
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    body = {"subject_id": school["english"]["id"], "term_id": school["term"]["id"], "lines": [{"enrollment_id": eids[0], "ca_score": 10, "exam_score": 10}]}
    r = client.post("/api/results/bulk", json=body, headers=teacher)
    assert r.json()["saved"] == 0 and r.json()["skipped"]
    r = client.post("/api/results", json={"enrollment_id": eids[0], "subject_id": school["english"]["id"], "term_id": school["term"]["id"], "ca_score": 1, "exam_score": 1}, headers=teacher)
    assert r.status_code == 403
    assert client.get("/api/results/sheet", params={"class_id": school["class"]["id"], "subject_id": school["english"]["id"], "term_id": school["term"]["id"]}, headers=teacher).status_code == 403


def test_self_approval_setting(client, admin, school):
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    client.post("/api/results/bulk", json={"subject_id": school["maths"]["id"], "term_id": school["term"]["id"], "lines": [{"enrollment_id": eids[0], "ca_score": 20, "exam_score": 30}]}, headers=teacher)
    rid = client.get("/api/results", headers=teacher).json()["items"][0]["id"]
    client.post(f"/api/results/{rid}/submit", headers=teacher)
    assert client.post(f"/api/results/{rid}/approve", headers=teacher).status_code == 403
    assert client.put("/api/settings", json={"allow_teacher_self_approval": True}, headers=admin).status_code == 200
    assert client.post(f"/api/results/{rid}/approve", headers=teacher).status_code == 200


def test_publish_directly_when_approval_disabled(client, admin, school):
    client.put("/api/settings", json={"require_approval": False}, headers=admin)
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    client.post("/api/results/bulk", json={"subject_id": school["maths"]["id"], "term_id": school["term"]["id"], "lines": [{"enrollment_id": eids[0], "ca_score": 20, "exam_score": 30}]}, headers=teacher)
    rid = client.get("/api/results", headers=teacher).json()["items"][0]["id"]
    assert client.post(f"/api/results/{rid}/submit", headers=teacher).json()["status"] == "PUBLISHED"


def test_grading_is_configurable(client, admin, school):
    scale = {"name": "Custom", "entries": [
        {"grade": "P", "description": "Pass", "min_score": 50, "max_score": 100, "grade_point": 1},
        {"grade": "X", "description": "Fail", "min_score": 0, "max_score": 49, "grade_point": 0}]}
    assert client.put("/api/grading-scale", json=scale, headers=admin).status_code == 200
    bad = {"name": "Bad", "entries": [{"grade": "P", "description": "Pass", "min_score": 50, "max_score": 90, "grade_point": 1}, {"grade": "X", "description": "F", "min_score": 0, "max_score": 49, "grade_point": 0}]}
    assert client.put("/api/grading-scale", json=bad, headers=admin).status_code == 422  # does not reach 100
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    client.post("/api/results/bulk", json={"subject_id": school["maths"]["id"], "term_id": school["term"]["id"], "lines": [{"enrollment_id": eids[0], "ca_score": 20, "exam_score": 31}]}, headers=teacher)
    assert client.get("/api/results", headers=teacher).json()["items"][0]["grade"] == "P"


# ------------------------------------------------------------------ result codes & checking


def _publish_all(client, admin, school):
    teacher = login(client, "ada")
    _, eids = _enroll_ids(client, admin, school)
    client.post("/api/results/bulk", json={"subject_id": school["maths"]["id"], "term_id": school["term"]["id"],
                "lines": [{"enrollment_id": eids[0], "ca_score": 30, "exam_score": 40}, {"enrollment_id": eids[1], "ca_score": 20, "exam_score": 40}]}, headers=teacher)
    ids = [r["id"] for r in client.get("/api/results", headers=teacher).json()["items"]]
    assert client.post("/api/results/batch/submit", json={"ids": ids}, headers=teacher).json()["done"] == 2
    assert client.post("/api/results/batch/approve", json={"ids": ids}, headers=admin).json()["done"] == 2
    assert client.post("/api/results/batch/publish", json={"ids": ids}, headers=admin).json()["done"] == 2


def _gen(client, admin, school, **kw):
    body = {"quantity": 1, "session_id": school["session"]["id"], "term_id": school["term"]["id"], **kw}
    r = client.post("/api/result-codes/generate", json=body, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def _check(client, school, sid, pin, term=None, session=None):
    return client.post("/api/results/check", json={"student_ref": sid, "code": pin, "session_id": session or school["session"]["id"], "term_id": term or school["term"]["id"]})


def test_code_generation_is_unique_secure_and_hashed(client, admin, school):
    batch = _gen(client, admin, school, quantity=50)
    pins = [c["pin"] for c in batch["codes"]]
    assert len(set(pins)) == 50 and all(p.startswith("SCH-") and len(p) == 18 for p in pins)
    assert len({c["serial"] for c in batch["codes"]}) == 50
    with SessionLocal() as db:
        rows = db.scalars(select(ResultAccessCode)).all()
        assert all(r.code_hash not in pins and len(r.code_hash) == 64 for r in rows)
    listing = client.get("/api/result-codes", headers=admin).json()
    assert listing["total"] == 50 and "pin" not in listing["items"][0]
    assert client.get("/api/result-codes/summary", headers=admin).json()["UNUSED"] == 50
    assert client.get("/api/result-codes/export.csv", headers=admin).text.count("RC-0000") == 50


def test_check_result_happy_path_and_limits(client, admin, school):
    _publish_all(client, admin, school)
    sid = school["students"][0]["student_no"]
    pin = _gen(client, admin, school, max_uses=2)["codes"][0]["pin"]
    r = _check(client, school, sid, pin.lower().replace("-", " "))  # formatting-insensitive
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report"]["summary"]["average"] == 70 and body["uses_remaining"] == 1
    assert body["report"]["student"]["name"] == "Chidi Okoro"
    pdf = client.get("/api/results/check/pdf", params={"token": body["pdf_token"]})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.get("/api/results/check/pdf", params={"token": "garbage"}).status_code == 400
    assert _check(client, school, sid, pin).status_code == 200
    assert _check(client, school, sid, pin).status_code == 400  # exhausted
    # a code first used by student 1 is now bound to them
    other = school["students"][1]["student_no"]
    pin2 = _gen(client, admin, school)["codes"][0]["pin"]
    assert _check(client, school, sid, pin2).status_code == 200
    assert _check(client, school, other, pin2).status_code == 400


def test_check_result_errors_are_generic(client, admin, school):
    _publish_all(client, admin, school)
    sid = school["students"][0]["student_no"]
    pin = _gen(client, admin, school)["codes"][0]["pin"]
    msgs = {
        _check(client, school, sid, "SCH-AAAA-BBBB-CCCC").json()["detail"],        # wrong pin, real student
        _check(client, school, "STU-9999-9999", pin).json()["detail"],              # real pin, unknown student
        _check(client, school, "STU-9999-9999", "SCH-AAAA-BBBB-CCCC").json()["detail"],
    }
    assert len(msgs) == 1


def test_check_result_scoping_expiry_and_disable(client, admin, school):
    _publish_all(client, admin, school)
    sid = school["students"][0]["student_no"]
    other_session = client.post("/api/sessions", json={"name": "2027/2028"}, headers=admin).json()
    # code for a different session
    wrong = _gen(client, admin, school)["codes"][0]["pin"]
    assert _check(client, school, sid, wrong, session=other_session["id"], term=other_session["terms"][0]["id"]).status_code == 400
    # other term
    t2 = school["session"]["terms"][1]["id"]
    assert _check(client, school, sid, wrong, term=t2).status_code == 400
    # disabled
    batch = _gen(client, admin, school)
    cid = client.get("/api/result-codes", headers=admin).json()["items"][0]["id"]
    assert client.put(f"/api/result-codes/{cid}", json={"is_active": False}, headers=admin).status_code == 200
    assert _check(client, school, sid, batch["codes"][0]["pin"]).status_code == 400
    client.put(f"/api/result-codes/{cid}", json={"is_active": True}, headers=admin)
    assert _check(client, school, sid, batch["codes"][0]["pin"]).status_code == 200
    # expired: set in the past directly
    exp = _gen(client, admin, school)
    with SessionLocal() as db:
        from datetime import timedelta
        from app.core.security import hash_code, utcnow

        row = db.scalars(select(ResultAccessCode).where(ResultAccessCode.code_hash == hash_code(exp["codes"][0]["pin"]))).one()
        row.expires_at = utcnow() - timedelta(days=1)
        db.commit()
    assert _check(client, school, sid, exp["codes"][0]["pin"]).status_code == 400


def test_unpublished_result_not_available(client, admin, school):
    sid = school["students"][0]["student_no"]
    pin = _gen(client, admin, school)["codes"][0]["pin"]
    r = _check(client, school, sid, pin)
    assert r.status_code == 404
    with SessionLocal() as db:
        assert db.scalars(select(ResultAccessCode)).one().use_count == 0


def test_check_result_is_rate_limited(client, admin, school):
    sid = school["students"][0]["student_no"]
    codes = []
    for i in range(14):
        codes.append(_check(client, school, sid if i % 2 else f"STU-0000-{i:04d}", f"SCH-AAAA-BBBB-C{i:03d}").status_code)
    assert 429 in codes
    # even a correct pin is blocked while throttled
    pin = _gen(client, admin, school)["codes"][0]["pin"]
    assert _check(client, school, sid, pin).status_code == 429


def test_access_is_logged(client, admin, school):
    _publish_all(client, admin, school)
    sid = school["students"][0]["student_no"]
    pin = _gen(client, admin, school)["codes"][0]["pin"]
    _check(client, school, sid, "SCH-AAAA-BBBB-CCCC")
    _check(client, school, sid, pin)
    cid = client.get("/api/result-codes", headers=admin).json()["items"][0]["id"]
    logs = client.get(f"/api/result-codes/{cid}/logs", headers=admin).json()
    assert logs and logs[0]["success"] is True and logs[0]["ip"]


def test_cards_pdf_requires_matching_pin(client, admin, school):
    batch = _gen(client, admin, school, quantity=3)
    r = client.post("/api/result-codes/cards.pdf", json={"cards": [{"serial": c["serial"], "pin": c["pin"]} for c in batch["codes"]]}, headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    bad = client.post("/api/result-codes/cards.pdf", json={"cards": [{"serial": batch["codes"][0]["serial"], "pin": "SCH-XXXX-XXXX-XXXX"}]}, headers=admin)
    assert bad.status_code == 400


def test_verification_exposes_limited_info(client, admin, school):
    _publish_all(client, admin, school)
    st = login(client, school["students"][0]["student_no"])
    card_id = client.get("/api/results/history", headers=st).json()[0]["terms"][0]["card_id"]
    ref = client.get(f"/api/report-cards/{card_id}", headers=st).json()["verification_ref"]
    v = client.get(f"/api/verify/{ref}").json()
    assert v["valid"] and v["student"] == "Chidi O." and "average" not in v
    assert client.get("/api/verify/VR-NOPE").json()["valid"] is False


# ------------------------------------------------------------------ materials


def _pdf_bytes():
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def _upload(client, headers, school, filename="note.pdf", mime="application/pdf", data=None, **extra):
    form = {"title": "Maths note", "subject_id": str(school["maths"]["id"]), "class_id": str(school["class"]["id"]), "visibility": "PUBLISHED", **extra}
    return client.post("/api/materials", data=form, files={"file": (filename, data if data is not None else _pdf_bytes(), mime)}, headers=headers)


def test_material_upload_security(client, admin, school):
    teacher = login(client, "ada")
    assert _upload(client, teacher, school).status_code == 201
    assert _upload(client, teacher, school, "evil.exe", "application/octet-stream", b"MZ\x00").status_code == 422
    assert _upload(client, teacher, school, "evil.pdf.exe", "application/pdf").status_code == 422
    assert _upload(client, teacher, school, "x.pdf", "image/png").status_code == 422      # declared MIME mismatch
    assert _upload(client, teacher, school, "x.pdf", "application/pdf", b"<html>").status_code == 422  # bad magic
    assert _upload(client, teacher, school, "page.html", "text/html", b"<script>").status_code == 422
    # teacher cannot upload for a subject they are not assigned
    r = client.post("/api/materials", data={"title": "Eng", "subject_id": str(school["english"]["id"]), "class_id": str(school["class"]["id"])},
                    files={"file": ("a.pdf", _pdf_bytes(), "application/pdf")}, headers=teacher)
    assert r.status_code == 403


def test_materials_visibility_for_students(client, admin, school):
    teacher = login(client, "ada")
    pub = _upload(client, teacher, school, visibility="PUBLISHED").json()
    draft = _upload(client, teacher, school, visibility="DRAFT").json()
    other_class = client.post("/api/classes", json={"name": "SS 1", "level_order": 4}, headers=admin).json()
    hidden = client.post("/api/materials", data={"title": "Other", "subject_id": str(school["maths"]["id"]), "class_id": str(other_class["id"]), "visibility": "PUBLISHED"},
                         files={"file": ("a.pdf", _pdf_bytes(), "application/pdf")}, headers=admin).json()
    st = login(client, school["students"][0]["student_no"])
    ids = {m["id"] for m in client.get("/api/materials", headers=st).json()["items"]}
    assert ids == {pub["id"]}
    assert client.get(f"/api/materials/{draft['id']}/download", headers=st).status_code == 404
    assert client.get(f"/api/materials/{hidden['id']}/download", headers=st).status_code == 404
    dl = client.get(f"/api/materials/{pub['id']}/download", headers=st)
    assert dl.status_code == 200 and dl.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/materials/{pub['id']}/download").status_code == 401
    # student received a notification
    notes = client.get("/api/notifications", headers=st).json()
    assert any("learning material" in n["title"].lower() for n in notes["items"])
    # students cannot upload or delete
    assert client.delete(f"/api/materials/{pub['id']}", headers=st).status_code == 403


# ------------------------------------------------------------------ public/admin features


def test_admission_flow(client, admin, school):
    body = {"first_name": "Ife", "last_name": "Bello", "date_of_birth": "2015-04-02", "gender": "FEMALE", "class_applied_id": school["class"]["id"],
            "address": "12 Some Street, Lagos", "guardian_name": "Mr Bello", "guardian_phone": "08031234567"}
    r = client.post("/api/public/applications", json=body)
    assert r.status_code == 201 and r.json()["reference"].startswith("APP-")
    apps = client.get("/api/applications", headers=admin).json()
    assert apps["total"] == 1
    adm = client.post(f"/api/applications/{apps['items'][0]['id']}/admit", headers=admin)
    assert adm.status_code == 201 and adm.json()["full_name"] == "Ife Bello"
    assert client.post(f"/api/applications/{apps['items'][0]['id']}/admit", headers=admin).status_code == 409


def test_announcements_public_and_drafts(client, admin):
    client.post("/api/announcements", json={"title": "Draft one", "body": "hidden", "status": "DRAFT"}, headers=admin)
    client.post("/api/announcements", json={"title": "Open day", "body": "welcome <script>alert(1)</script>", "status": "PUBLISHED"}, headers=admin)
    items = client.get("/api/public/announcements").json()["items"]
    assert [a["title"] for a in items] == ["Open day"]


def test_password_reset_flow(client, admin, caplog):
    with SessionLocal() as db:
        u = db.scalars(select(User).where(User.username == "admin")).one()
        u.email = "admin@example.com"
        db.commit()
    with caplog.at_level("INFO", logger="school.notify"):
        assert client.post("/api/auth/forgot-password", json={"identifier": "admin@example.com"}).status_code == 202
    token = caplog.text.split("token=")[1].split()[0]
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPass123"}).status_code == 200
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPass123"}).status_code == 400  # single use
    assert client.post("/api/auth/login", json={"username": "admin", "password": "NewPass123"}).status_code == 200
    # unknown account gets the same response
    assert client.post("/api/auth/forgot-password", json={"identifier": "ghost@example.com"}).status_code == 202


def test_dashboards_and_security_headers(client, admin, school):
    d = client.get("/api/dashboard", headers=admin)
    assert d.status_code == 200 and d.json()["totals"]["students"] == 2
    t = client.get("/api/teachers/me/overview", headers=login(client, "ada")).json()
    assert t["student_count"] == 2 and len(t["assignments"]) == 1 and t["results"]["NOT_STARTED"] == 2
    s = client.get("/api/dashboard/student", headers=login(client, school["students"][0]["student_no"]))
    assert s.status_code == 200 and s.json()["class_name"] == "JSS 1 A"
    h = client.get("/api/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and "content-security-policy" in h


def test_validation_errors_do_not_leak(client, admin):
    r = client.post("/api/subjects", json={"name": "", "code": ""}, headers=admin)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert client.get("/api/students/999999", headers=admin).status_code == 404


def test_settings_assets_and_public_school(client, admin):
    assert client.put("/api/settings", json={"name": "Test School", "motto": "Light", "primary_color": "#112233"}, headers=admin).status_code == 200
    pub = client.get("/api/public/school").json()
    assert pub["name"] == "Test School" and "ca_max" not in pub
    assert client.put("/api/settings", json={"primary_color": "red"}, headers=admin).status_code == 422
    assert client.put("/api/settings", json={"map_embed_url": "javascript:alert(1)"}, headers=admin).status_code == 422
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (20, 20), (255, 0, 0, 128)).save(buf, "PNG")
    assert client.post("/api/settings/assets/logo", files={"file": ("l.png", buf.getvalue(), "image/png")}, headers=admin).status_code == 200
    assert client.get("/api/public/media/logo").status_code == 200
    assert client.get("/api/public/media/signature").status_code == 404  # private assets are not public


def test_class_performance_report(client, admin, school):
    _publish_all(client, admin, school)
    r = client.get("/api/reports/class-performance", params={"term_id": school["term"]["id"], "class_id": school["class"]["id"]}, headers=admin).json()
    assert r["subjects"][0]["subject"] == "Mathematics" and len(r["ranking"]) == 2 and r["ranking"][0]["position"] == "1st"
