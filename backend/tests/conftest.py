import os
import shutil
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="school-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["LOCAL_STORAGE_DIR"] = str(_tmp / "storage")
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-test-secret-key-test-secret"
os.environ["CODE_PEPPER"] = "test-pepper-test-pepper-test-pepper"
os.environ["FRONTEND_URL"] = "http://testserver"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app, bootstrap_defaults  # noqa: E402
from app.models import User  # noqa: E402

PASSWORD = "Passw0rd!x"

# Cheap Argon2 parameters keep the suite fast; production uses the library defaults.
import app.core.security as _security  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402

_security._hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)

from sqlalchemy import event  # noqa: E402


@event.listens_for(engine, "connect")
def _fast_sqlite(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA synchronous=OFF")
    cur.execute("PRAGMA journal_mode=MEMORY")
    cur.close()


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    bootstrap_defaults()
    limiter.reset()
    from app.core.deps import invalidate_permission_cache

    invalidate_permission_cache()
    with SessionLocal() as db:
        db.add(User(username="super", full_name="Super Admin", role="SUPER_ADMIN", password_hash=hash_password(PASSWORD)))
        db.add(User(username="admin", full_name="Admin User", role="ADMIN", password_hash=hash_password(PASSWORD)))
        db.commit()
    yield


@pytest.fixture
def client():
    return TestClient(app)


def login(client: TestClient, username: str, password: str = PASSWORD) -> dict:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return login(client, "admin")


@pytest.fixture
def superadmin(client):
    return login(client, "super")


@pytest.fixture
def school(client, admin):
    """Session + class + subjects + teacher (assigned) + two students, all created through the API."""
    h = admin
    sess = client.post("/api/sessions", json={"name": "2026/2027"}, headers=h).json()
    term = sess["terms"][0]
    klass = client.post("/api/classes", json={"name": "JSS 1", "level_order": 1}, headers=h).json()
    arm = client.post(f"/api/classes/{klass['id']}/arms", json={"name": "A"}, headers=h).json()["arms"][0]
    maths = client.post("/api/subjects", json={"name": "Mathematics", "code": "MTH"}, headers=h).json()
    english = client.post("/api/subjects", json={"name": "English", "code": "ENG"}, headers=h).json()
    t = client.post("/api/teachers", json={"full_name": "Ada Teacher", "username": "ada"}, headers=h)
    assert t.status_code == 201, t.text
    teacher = t.json()
    with SessionLocal() as db:
        u = db.get(User, teacher["user_id"])
        u.password_hash = hash_password(PASSWORD)
        u.must_change_password = False
        db.commit()
    r = client.put(
        f"/api/teachers/{teacher['id']}/assignments",
        json={"session_id": sess["id"], "items": [{"class_id": klass["id"], "arm_id": arm["id"], "subject_id": maths["id"]}]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    studs = []
    for first, last in (("Chidi", "Okoro"), ("Bola", "Adeyemi")):
        s = client.post("/api/students", json={"first_name": first, "last_name": last, "class_id": klass["id"], "arm_id": arm["id"]}, headers=h)
        assert s.status_code == 201, s.text
        studs.append(s.json())
    with SessionLocal() as db:
        for s in studs:
            u = db.scalars(select(User).where(User.username == s["student_no"])).one()
            u.password_hash = hash_password(PASSWORD)
            u.must_change_password = False
        db.commit()
    return {"session": sess, "term": term, "class": klass, "arm": arm, "maths": maths, "english": english, "teacher": teacher, "students": studs}


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_tmp, ignore_errors=True)
