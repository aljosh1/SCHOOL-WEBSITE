"""Demo data. Usage: python -m app.seed [--reset]

Refuses to run when ENVIRONMENT=production. Every account created here is flagged is_demo.
"""
import io
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.core.security import generate_access_code, hash_code, hash_password
from app.core.storage import get_storage, new_key
from app.models import (
    AcademicSession, Announcement, AdmissionApplication, ClassArm, Enrollment, LearningMaterial, Notification,
    Parent, ReportCard, Result, ResultAccessCode, SchoolClass, Student, Subject, Teacher, TeachingAssignment, Term, User,
)
from app.services import access
from app.services.grading import active_entries, install_default_scale
from app.services.results import apply_scores, ensure_report_card

DEMO_STAFF_PASSWORD = "Demo@12345"
DEMO_STUDENT_PASSWORD = "Student@123"
rng = random.Random(2026)

FIRST = {"MALE": ["Chinedu", "Tunde", "Emeka", "Ibrahim", "Segun", "Musa", "Daniel", "Femi", "Uche", "Yusuf", "Kelechi", "David"],
         "FEMALE": ["Amaka", "Chioma", "Aisha", "Funke", "Ngozi", "Zainab", "Blessing", "Tolu", "Ifeoma", "Halima", "Grace", "Bukola"]}
LAST = ["Okafor", "Adeyemi", "Bello", "Nwosu", "Balogun", "Eze", "Abubakar", "Ogunleye", "Okonkwo", "Lawal", "Obi", "Salami", "Mohammed", "Ajayi"]
SUBJECTS = [
    ("Mathematics", "MTH"), ("English Language", "ENG"), ("Basic Science", "BSC"), ("Computer Studies", "CMP"),
    ("Physics", "PHY"), ("Chemistry", "CHM"), ("Biology", "BIO"), ("Civic Education", "CVE"), ("Basic Technology", "BTC"),
    ("Social Studies", "SOS"), ("Business Studies", "BUS"), ("Agricultural Science", "AGR"),
]
CLASSES = ["JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"]
SUBJECTS_FOR = {
    "JSS 1": ["MTH", "ENG", "BSC", "CMP", "CVE", "BTC", "SOS", "BUS"],
    "JSS 2": ["MTH", "ENG", "BSC", "CMP", "CVE", "BTC", "SOS", "BUS"],
    "JSS 3": ["MTH", "ENG", "BSC", "CMP", "CVE", "BTC", "SOS", "BUS"],
    "SS 1": ["MTH", "ENG", "PHY", "CHM", "BIO", "CMP", "CVE", "AGR"],
    "SS 2": ["MTH", "ENG", "PHY", "CHM", "BIO", "CMP", "CVE", "AGR"],
    "SS 3": ["MTH", "ENG", "PHY", "CHM", "BIO", "CMP", "CVE", "AGR"],
}
TEACHERS = [
    ("Mrs. Folake Adebayo", "f.adebayo", "B.Sc. Mathematics Education, PGDE", ["MTH"]),
    ("Mr. Ikenna Okeke", "i.okeke", "B.A. English Language, PGDE", ["ENG", "CVE"]),
    ("Mr. Sadiq Garba", "s.garba", "B.Sc. Computer Science", ["CMP", "BTC"]),
    ("Mrs. Ngozi Eze", "n.eze", "B.Sc. Biology, M.Sc. Ecology", ["BIO", "BSC", "AGR"]),
    ("Mr. Tunde Ogunbanjo", "t.ogunbanjo", "B.Sc. Physics, B.Ed.", ["PHY", "CHM", "SOS", "BUS"]),
]


def _avatar(initials: str, hue: int) -> bytes:
    img = Image.new("RGB", (400, 400), (255, 255, 255))
    d = ImageDraw.Draw(img)
    colors = [(20, 83, 45), (30, 64, 175), (146, 64, 14), (109, 40, 217), (190, 18, 60), (15, 118, 110)]
    d.rectangle([0, 0, 400, 400], fill=colors[hue % len(colors)])
    try:
        font = ImageFont.truetype("arial.ttf", 150)
    except OSError:
        font = ImageFont.load_default(size=150)
    d.text((200, 200), initials, fill="white", anchor="mm", font=font)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def _logo() -> bytes:
    img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([10, 10, 390, 390], fill=(20, 83, 45, 255), outline=(180, 83, 9, 255), width=14)
    d.polygon([(200, 80), (320, 150), (80, 150)], fill=(255, 255, 255, 255))
    d.rectangle([110, 160, 290, 270], fill=(255, 255, 255, 255))
    d.rectangle([180, 200, 220, 270], fill=(20, 83, 45, 255))
    try:
        font = ImageFont.truetype("arial.ttf", 56)
    except OSError:
        font = ImageFont.load_default(size=56)
    d.text((200, 330), "EHC", fill=(255, 255, 255, 255), anchor="mm", font=font)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _note_pdf(title: str, lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(title)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(60, 780, title)
    c.setFont("Helvetica", 11)
    y = 745
    for ln in lines:
        c.drawString(60, y, ln)
        y -= 18
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(60, 60, "DEMO CONTENT - Excellence Heights College")
    c.save()
    return buf.getvalue()


def run(reset: bool = False) -> None:
    settings = get_settings()
    if settings.is_production:
        sys.exit("Refusing to seed demo data in production.")
    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    storage = get_storage()
    with SessionLocal() as db:
        if db.scalars(select(User.id).limit(1)).first():
            sys.exit("Database already has users. Run with --reset to wipe and reseed.")
        school = access.get_school(db)
        install_default_scale(db)
        logo_key = new_key("assets", "png")
        storage.put(logo_key, _logo(), "image/png")
        school.name = "Excellence Heights College (DEMO)"
        school.short_name = "EHC"
        school.motto = "Building Tomorrow's Leaders"
        school.address = "12 Education Avenue, Ikeja, Lagos State, Nigeria"
        school.phone = "+234 803 000 0000"
        school.email = "info@excellenceheights.example"
        school.website = "http://localhost:5173"
        school.facebook = "https://facebook.com/"
        school.instagram = "https://instagram.com/"
        school.twitter = "https://x.com/"
        school.youtube = "https://youtube.com/"
        school.logo_key = logo_key
        school.principal_name = "Dr. (Mrs.) Adaobi Nwankwo"
        school.principal_title = "Principal"
        school.principal_message = (
            "Welcome to Excellence Heights College. We believe every child can excel when given a safe, structured and "
            "inspiring environment. Our dedicated teachers, modern facilities and technology-driven approach prepare our "
            "students for WAEC, NECO and life beyond the classroom. Together with parents, we are building tomorrow's leaders."
        )
        school.history = (
            "Excellence Heights College was founded in 2004 with 40 students and a simple promise: to deliver quality, "
            "values-driven education. Two decades later we serve over a thousand students from JSS 1 to SS 3, with consistently "
            "outstanding WAEC and NECO results."
        )
        school.vision = "To be the leading centre of academic excellence and character development in West Africa."
        school.mission = "To nurture disciplined, creative and technologically-capable young people through qualified teachers, modern facilities and strong values."
        school.philosophy = "Learning is most effective when it is student-centred, practical, and rooted in strong moral values."
        school.core_values = ["Integrity", "Excellence", "Discipline", "Innovation", "Service", "Respect"]
        school.map_embed_url = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3963.9!2d3.34!3d6.6!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sng"
        school.result_footer_note = "DEMO DATA - this report card is not a real document."

        # --- accounts
        def mk_user(username, name, role, email=None, pw=DEMO_STAFF_PASSWORD, phone=None):
            u = User(username=username, full_name=name, role=role, email=email, phone=phone,
                     password_hash=hash_password(pw), is_demo=True, must_change_password=False)
            db.add(u)
            db.flush()
            return u

        superadmin = mk_user("superadmin.demo", "Demo Super Admin", "SUPER_ADMIN", "superadmin.demo@example.com")
        admin = mk_user("admin.demo", "Demo Administrator", "ADMIN", "admin.demo@example.com")

        # --- academics
        classes: dict[str, SchoolClass] = {}
        for i, n in enumerate(CLASSES, 1):
            c = SchoolClass(name=n, level_order=i)
            c.arms.append(ClassArm(name="A"))
            if n == "JSS 1":
                c.arms.append(ClassArm(name="B"))
            db.add(c)
            classes[n] = c
        subjects = {code: Subject(name=n, code=code, category="Core" if code in ("MTH", "ENG") else "General") for n, code in SUBJECTS}
        db.add_all(subjects.values())
        prev = AcademicSession(name="2025/2026", start_date=date(2025, 9, 8), end_date=date(2026, 7, 24), is_current=False)
        cur = AcademicSession(name="2026/2027", start_date=date(2026, 9, 14), end_date=date(2027, 7, 23), is_current=True)
        for s in (prev, cur):
            for i, n in enumerate(("First Term", "Second Term", "Third Term"), 1):
                s.terms.append(Term(name=n, position=i))
        cur.terms[0].is_current = True
        cur.terms[0].next_term_begins = date(2027, 1, 11)
        prev.terms[0].next_term_begins = date(2026, 1, 12)
        db.add_all([prev, cur])
        db.flush()

        teachers: dict[str, Teacher] = {}
        for i, (name, uname, qual, codes) in enumerate(TEACHERS, 1):
            u = mk_user(uname + ".demo", name, "TEACHER", f"{uname}@excellenceheights.example", phone=f"0803000{i:04d}")
            t = Teacher(user_id=u.id, staff_no=f"TCH-{i:04d}", qualification=qual, public_title="Teacher of " + ", ".join(subjects[c].name for c in codes[:2]))
            db.add(t)
            db.flush()
            for code in codes:
                teachers[code] = t
        # assignments: each teacher teaches its subjects across all classes that offer them
        for cname, codes in SUBJECTS_FOR.items():
            for code in codes:
                t = teachers[code]
                db.add(TeachingAssignment(teacher_id=t.id, session_id=cur.id, class_id=classes[cname].id, arm_id=None, subject_id=subjects[code].id))
                db.add(TeachingAssignment(teacher_id=t.id, session_id=prev.id, class_id=classes[cname].id, arm_id=None, subject_id=subjects[code].id))
        classes["JSS 1"].arms[0].form_teacher_id = teachers["MTH"].id
        db.flush()

        # --- students
        layout = [("JSS 1", "A", 8, None), ("JSS 1", "B", 4, None), ("JSS 2", "A", 7, "JSS 1"), ("JSS 3", "A", 6, "JSS 2"), ("SS 2", "A", 7, "SS 1")]
        seq, students_by_class = 0, {}
        for cname, arm, n, prev_class in layout:
            arm_obj = next(a for a in classes[cname].arms if a.name == arm)
            for _ in range(n):
                seq += 1
                g = rng.choice(["MALE", "FEMALE"])
                first, last = rng.choice(FIRST[g]), rng.choice(LAST)
                age = {"JSS 1": 11, "JSS 2": 12, "JSS 3": 13, "SS 1": 14, "SS 2": 15}[cname]
                parent = Parent(full_name=f"Mr/Mrs {last}", relationship_type="Parent", phone=f"0803{rng.randint(1000000, 9999999)}",
                                email=f"parent{seq}@example.com", address="Lagos, Nigeria", occupation=rng.choice(["Trader", "Engineer", "Teacher", "Civil servant"]))
                db.add(parent)
                key = new_key("photos", "jpg")
                storage.put(key, _avatar(first[0] + last[0], seq), "image/jpeg")
                st = Student(
                    student_no=f"STU-2026-{seq:04d}", admission_no=f"ADM-2026-{seq:04d}", first_name=first, last_name=last, gender=g,
                    date_of_birth=date(2026 - age, rng.randint(1, 12), rng.randint(1, 28)), address="Ikeja, Lagos", state_of_origin=rng.choice(["Lagos", "Anambra", "Kano", "Ogun", "Oyo"]),
                    admission_date=date(2024, 9, 9), status="ACTIVE", parent=parent, photo_key=key,
                    emergency_name=parent.full_name, emergency_phone=parent.phone, emergency_relationship="Parent",
                )
                u = mk_user(st.student_no, f"{first} {last}", "STUDENT", pw=DEMO_STUDENT_PASSWORD)
                st.user_id = u.id
                db.add(st)
                db.flush()
                e = Enrollment(student_id=st.id, session_id=cur.id, class_id=classes[cname].id, arm_id=arm_obj.id)
                db.add(e)
                pe = None
                if prev_class:
                    pe = Enrollment(student_id=st.id, session_id=prev.id, class_id=classes[prev_class].id, arm_id=classes[prev_class].arms[0].id, status="PROMOTED")
                    db.add(pe)
                db.flush()
                students_by_class.setdefault(cname, []).append((st, e, pe, prev_class))

        # --- results
        entries = active_entries(db)
        now = datetime.now(timezone.utc)

        def score(ability: float):
            ca = max(0, min(40, round(rng.gauss(ability * 0.4, 4))))
            ex = max(0, min(60, round(rng.gauss(ability * 0.6, 7))))
            return float(ca), float(ex)

        abilities = {}
        for lst in students_by_class.values():
            for st, *_ in lst:
                abilities[st.id] = rng.uniform(48, 92)

        def make_result(enrollment, code, term, ability, status, by_user):
            r = Result(enrollment_id=enrollment.id, subject_id=subjects[code].id, term_id=term.id, entered_by_id=teachers[code].user_id, status=status)
            ca, ex = score(ability)
            apply_scores(entries, school, r, ca, ex)
            if status in ("SUBMITTED", "APPROVED", "PUBLISHED"):
                r.submitted_by_id, r.submitted_at = teachers[code].user_id, now
            if status in ("APPROVED", "PUBLISHED"):
                r.approved_by_id, r.approved_at = admin.id, now
            if status == "PUBLISHED":
                r.published_by_id, r.published_at = admin.id, now
                db.add(r)
                db.flush()
                card, _ = ensure_report_card(db, enrollment.id, term.id)
                card.first_published_at = now
                return r
            db.add(r)
            return r

        for cname, lst in students_by_class.items():
            for st, e, pe, prev_class in lst:
                if pe:
                    for term in prev.terms:
                        for code in SUBJECTS_FOR[prev_class]:
                            make_result(pe, code, term, abilities[st.id] + rng.uniform(-5, 5), "PUBLISHED", admin)
        first_term = cur.terms[0]
        jss1 = students_by_class["JSS 1"]
        for idx, (st, e, _, _) in enumerate(jss1):
            for code in SUBJECTS_FOR["JSS 1"]:
                # Maths/English published; others at different workflow stages for demo of the pipeline.
                status = {"MTH": "PUBLISHED", "ENG": "PUBLISHED", "BSC": "SUBMITTED", "CMP": "SUBMITTED", "CVE": "DRAFT"}.get(code)
                if status:
                    make_result(e, code, first_term, abilities[st.id], status, admin)
        db.flush()
        for card in db.scalars(select(ReportCard).where(ReportCard.term_id == first_term.id)):
            card.first_published_at = now

        # --- codes (a mix of unused/used/expired/disabled)
        demo_codes = []
        for i in range(1, 21):
            pin = generate_access_code(school.code_prefix)
            c = ResultAccessCode(serial=f"RC-{i:06d}", code_hash=hash_code(pin), code_last4=pin[-4:], batch_ref="BDEMO-0001",
                                 session_id=cur.id, term_id=first_term.id, max_uses=5, created_by_id=admin.id)
            if i == 19:
                c.expires_at = now - timedelta(days=2)
            if i == 20:
                c.is_active = False
            db.add(c)
            demo_codes.append((c.serial, pin))
        # bind first three codes to first three JSS 1 students for realistic demo
        db.flush()
        # --- materials
        def add_material(title, desc, subject, cls, uploader_code, kind, text=None, with_pdf=True, vis="PUBLISHED"):
            t = teachers[uploader_code]
            m = LearningMaterial(title=title, description=desc, subject_id=subjects[subject].id, class_id=classes[cls].id, teacher_id=t.id,
                                 uploaded_by_id=t.user_id, session_id=cur.id, term_id=first_term.id, visibility=vis, kind=kind, text_content=text)
            if with_pdf:
                data = _note_pdf(title, [desc, "", "This is a demo learning material.", "Upload your own PDF, Word, PowerPoint, image, audio or video files."])
                key = new_key("materials", "pdf")
                storage.put(key, data, "application/pdf")
                m.file_key, m.file_name, m.mime_type, m.size_bytes = key, f"{title}.pdf", "application/pdf", len(data)
                m.kind = kind if kind in ("NOTE", "ASSIGNMENT", "PAST_QUESTION") else "PDF"
            db.add(m)

        add_material("Mathematics Note 01 - Whole Numbers", "Place value, rounding and operations on whole numbers.", "MTH", "JSS 1", "MTH", "NOTE")
        add_material("Mathematics Assignment 1", "Ten practice questions on fractions.", "MTH", "JSS 1", "MTH", "ASSIGNMENT")
        add_material("English Language - Parts of Speech", "Nouns, pronouns, verbs, adjectives and adverbs with examples.", "ENG", "JSS 1", "ENG", "NOTE")
        add_material("Computer Studies - Parts of a Computer", "Hardware and software basics.", "CMP", "JSS 1", "CMP", "NOTE",
                     text="A computer has input devices, a processing unit, memory, storage and output devices.", with_pdf=False)
        add_material("Basic Science Past Questions", "Past examination questions with answers.", "BSC", "JSS 1", "BIO", "PAST_QUESTION")
        add_material("Physics - Motion Revision", "Speed, velocity and acceleration worked examples.", "PHY", "SS 2", "PHY", "NOTE")
        add_material("Chemistry Draft Notes", "Unpublished draft for demo.", "CHM", "SS 2", "PHY", "NOTE", vis="DRAFT")

        # --- announcements
        author = admin.id
        def ann(title, body, cat, days_ago=0, event=None):
            db.add(Announcement(title=title, body=body, category=cat, status="PUBLISHED", author_id=author, is_public=True,
                                published_at=now - timedelta(days=days_ago), event_date=event))
        ann("First Term 2026/2027 Resumption", "Students resumed on Monday 14 September 2026. Punctuality and full uniform are compulsory.", "ACADEMIC", 17)
        ann("Inter-House Sports Competition", "Our annual inter-house sports will hold on 20 November 2026. Parents are warmly invited.", "EVENT", 6, date(2026, 11, 20))
        ann("First Term Examination Timetable", "First term examinations begin on Monday 7 December 2026. The full timetable is available at the school office.", "EXAM", 3, date(2026, 12, 7))
        ann("Admission into JSS 1 and SS 1 - 2027/2028", "Applications are now open. Apply online from the Admissions page.", "ADMISSION", 2)
        ann("PTA Meeting", "The first PTA meeting of the session holds on Saturday 31 October 2026 at 10:00 am in the school hall.", "PARENT_NOTICE", 1, date(2026, 10, 31))
        ann("Christmas Holiday", "The school will close for the Christmas break on 18 December 2026.", "HOLIDAY", 0, date(2026, 12, 18))

        # --- admissions
        for i, (fn, ln) in enumerate([("Somtochi", "Eze"), ("Abdul", "Rahman")], 1):
            db.add(AdmissionApplication(reference=f"APP-2026-DEMO{i:02d}", first_name=fn, last_name=ln, date_of_birth=date(2015, 3, i + 5), gender="FEMALE" if i == 1 else "MALE",
                                        class_applied_id=classes["JSS 1"].id, address="Surulere, Lagos", guardian_name=f"Mr {ln}", guardian_phone="08031112222",
                                        guardian_email=f"guardian{i}@example.com", previous_school="Little Stars Primary School"))

        # --- notifications
        db.add(Notification(user_id=admin.id, title="Teachers submitted results", message="Basic Science and Computer Studies results for JSS 1 are awaiting approval.", link="/portal/approvals"))
        db.add(Notification(user_id=teachers["CVE"].user_id, title="Pending results", message="You have pending results for JSS 1 Civic Education.", link="/portal/results"))
        for st, *_ in jss1:
            db.add(Notification(user_id=st.user_id, title="Result published", message="Your First Term result has been published.", link="/portal/my-results"))
            db.add(Notification(user_id=st.user_id, title="New learning material", message="New Mathematics learning material uploaded: Mathematics Note 01 - Whole Numbers", link="/portal/materials"))
        db.commit()

        # Bind a couple of cards to specific students so the demo shows assigned codes.
        for (serial, pin), (st, *_) in zip(demo_codes[:3], jss1[:3]):
            c = db.scalars(select(ResultAccessCode).where(ResultAccessCode.serial == serial)).one()
            c.student_id = st.id
        db.commit()

        out = Path(settings.local_storage_dir)
        out.mkdir(parents=True, exist_ok=True)
        lines = [
            "DEMO CREDENTIALS (demo data only - never use in production)",
            f"Super admin : superadmin.demo / {DEMO_STAFF_PASSWORD}",
            f"Admin       : admin.demo / {DEMO_STAFF_PASSWORD}",
            *(f"Teacher     : {u}.demo / {DEMO_STAFF_PASSWORD}   ({n})" for n, u, _q, _c in TEACHERS),
            f"Students    : STU-2026-0001 ... STU-2026-{seq:04d} / {DEMO_STUDENT_PASSWORD}",
            "",
            "RESULT-CHECK DEMO (First Term 2026/2027, JSS 1 A; Mathematics + English published):",
            f"Student ID  : {jss1[0][0].student_no}",
            *(f"Card {s}: {p}" + ("  (student-bound)" if i < 3 else "") for i, (s, p) in enumerate(demo_codes[:10])),
            f"Expired card {demo_codes[18][0]}: {demo_codes[18][1]}",
            f"Disabled card {demo_codes[19][0]}: {demo_codes[19][1]}",
            "Previous session 2025/2026 (all three terms) is published for JSS 2, JSS 3 and SS 2 students.",
        ]
        (out / "demo_credentials.txt").write_text("\n".join(lines), encoding="utf-8")
        print("\n".join(lines))


if __name__ == "__main__":
    run(reset="--reset" in sys.argv)
