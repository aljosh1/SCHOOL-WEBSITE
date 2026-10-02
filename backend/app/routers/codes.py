import csv
import io
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.core.audit import audit
from app.core.deps import DB, get_or_404, require_perm
from app.core.ratelimit import rate_limit
from app.core.security import generate_access_code, hash_code, utcnow
from app.core.storage import get_storage
from app.models import AcademicSession, ResultAccessCode, ResultAccessLog, Student, Term, User
from app.schemas import CardsPdfIn, CodeGenerateIn, CodeUpdateIn
from app.services import access
from app.services.pdf import cards_pdf

router = APIRouter(prefix="/result-codes", tags=["result-codes"])
manage = require_perm("codes.manage")


def code_status(c: ResultAccessCode, now=None) -> str:
    now = now or utcnow()
    if not c.is_active:
        return "DISABLED"
    if c.expires_at and c.expires_at < now:
        return "EXPIRED"
    if c.use_count >= c.max_uses:
        return "EXHAUSTED"
    return "USED" if c.use_count > 0 else "UNUSED"


def code_dict(c: ResultAccessCode) -> dict:
    return {
        "id": c.id,
        "serial": c.serial,
        "masked": f"****-****-{c.code_last4}",
        "session_id": c.session_id,
        "session": c.session.name if c.session else None,
        "term_id": c.term_id,
        "term": c.term.name if c.term else None,
        "student_id": c.student_id,
        "student": c.student.full_name if c.student else None,
        "student_no": c.student.student_no if c.student else None,
        "max_uses": c.max_uses,
        "use_count": c.use_count,
        "expires_at": c.expires_at,
        "is_active": c.is_active,
        "status": code_status(c),
        "batch_ref": c.batch_ref,
        "created_at": c.created_at,
        "first_used_at": c.first_used_at,
        "last_used_at": c.last_used_at,
    }


def _filtered(stmt, q, status, session_id, term_id, batch_ref):
    now = utcnow()
    if session_id:
        stmt = stmt.where(ResultAccessCode.session_id == session_id)
    if term_id:
        stmt = stmt.where(ResultAccessCode.term_id == term_id)
    if batch_ref:
        stmt = stmt.where(ResultAccessCode.batch_ref == batch_ref)
    live = and_(ResultAccessCode.is_active.is_(True), or_(ResultAccessCode.expires_at.is_(None), ResultAccessCode.expires_at >= now))
    if status == "DISABLED":
        stmt = stmt.where(ResultAccessCode.is_active.is_(False))
    elif status == "EXPIRED":
        stmt = stmt.where(ResultAccessCode.is_active.is_(True), ResultAccessCode.expires_at < now)
    elif status == "EXHAUSTED":
        stmt = stmt.where(live, ResultAccessCode.use_count >= ResultAccessCode.max_uses)
    elif status == "USED":
        stmt = stmt.where(live, ResultAccessCode.use_count > 0, ResultAccessCode.use_count < ResultAccessCode.max_uses)
    elif status == "UNUSED":
        stmt = stmt.where(live, ResultAccessCode.use_count == 0)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.outerjoin(Student, Student.id == ResultAccessCode.student_id).where(
            or_(
                func.lower(ResultAccessCode.serial).like(like),
                func.lower(ResultAccessCode.code_last4).like(like),
                func.lower(Student.first_name).like(like),
                func.lower(Student.last_name).like(like),
                func.lower(Student.student_no).like(like),
            )
        )
    return stmt


_OPTS = (joinedload(ResultAccessCode.session), joinedload(ResultAccessCode.term), joinedload(ResultAccessCode.student))


@router.post("/generate", status_code=201)
def generate(body: CodeGenerateIn, request: Request, db: DB, user: User = Depends(manage)):
    school = access.get_school(db)
    session = get_or_404(db, AcademicSession, body.session_id, "Session")
    term = None
    if body.term_id:
        term = get_or_404(db, Term, body.term_id, "Term")
        if term.session_id != session.id:
            raise HTTPException(422, "The term does not belong to the selected session")
    if body.student_id and not db.get(Student, body.student_id):
        raise HTTPException(422, "Selected student does not exist")
    now = utcnow()
    expires = body.expires_at or (now + timedelta(days=school.code_default_expiry_days) if school.code_default_expiry_days else None)
    if expires and expires <= now:
        raise HTTPException(422, "Expiry date must be in the future")
    max_uses = body.max_uses or school.code_default_max_uses
    batch_ref = f"B{now:%Y%m%d}-{secrets.token_hex(2).upper()}"

    for _attempt in range(3):
        last = db.scalar(select(ResultAccessCode.serial).order_by(ResultAccessCode.id.desc()).limit(1))
        start = int(last.split("-")[-1]) + 1 if last and last.split("-")[-1].isdigit() else 1
        created, plain = [], []
        hashes: set[str] = set()
        for i in range(body.quantity):
            while True:
                pin = generate_access_code(school.code_prefix)
                h = hash_code(pin)
                if h not in hashes:
                    hashes.add(h)
                    break
            serial = f"RC-{start + i:06d}"
            created.append(
                ResultAccessCode(
                    serial=serial, code_hash=h, code_last4=pin[-4:], batch_ref=batch_ref, session_id=session.id,
                    term_id=term.id if term else None, student_id=body.student_id, max_uses=max_uses,
                    expires_at=expires, created_by_id=user.id,
                )
            )
            plain.append({"serial": serial, "pin": pin, "session": session.name, "term": term.name if term else "Any term",
                          "expires_at": expires.isoformat() if expires else None, "max_uses": max_uses})
        try:
            with db.begin_nested():
                db.add_all(created)
                db.flush()
            break
        except IntegrityError:
            for c in created:
                if c in db:
                    db.expunge(c)
            created = []
    if not created:
        raise HTTPException(409, "Could not allocate unique serial numbers. Please try again.")
    audit(db, request, user, "RESULT_CODE_GENERATE", "result_code", batch_ref,
          {"quantity": body.quantity, "session_id": session.id, "term_id": body.term_id, "serials": f"{plain[0]['serial']}..{plain[-1]['serial']}"})
    db.commit()
    return {"batch_ref": batch_ref, "count": len(plain), "codes": plain}


@router.get("")
def list_codes(
    db: DB,
    _: User = Depends(manage),
    q: str | None = None,
    status: str | None = None,
    session_id: int | None = None,
    term_id: int | None = None,
    batch_ref: str | None = None,
    page: int = 1,
    page_size: int = 25,
):
    page_size = min(max(page_size, 1), 200)
    stmt = _filtered(select(ResultAccessCode), q, status, session_id, term_id, batch_ref)
    total = db.scalar(stmt.order_by(None).with_only_columns(func.count(func.distinct(ResultAccessCode.id)), maintain_column_froms=True))
    rows = db.scalars(
        stmt.options(*_OPTS).order_by(ResultAccessCode.id.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size)
    ).unique()
    return {"items": [code_dict(c) for c in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/summary")
def summary(db: DB, _: User = Depends(manage)):
    out = {}
    for s in ("UNUSED", "USED", "EXHAUSTED", "EXPIRED", "DISABLED"):
        out[s] = db.scalar(_filtered(select(func.count(ResultAccessCode.id)), None, s, None, None, None))
    out["TOTAL"] = db.scalar(select(func.count(ResultAccessCode.id)))
    return out


@router.get("/export.csv")
def export_csv(
    request: Request,
    db: DB,
    user: User = Depends(manage),
    q: str | None = None,
    status: str | None = None,
    session_id: int | None = None,
    term_id: int | None = None,
    batch_ref: str | None = None,
):
    stmt = _filtered(select(ResultAccessCode), q, status, session_id, term_id, batch_ref)
    rows = db.scalars(stmt.options(*_OPTS).order_by(ResultAccessCode.id).limit(10000)).unique().all()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Serial", "PIN (masked)", "Session", "Term", "Status", "Uses", "Max uses", "Expires", "Student ID", "Batch", "Created"])
    for c in rows:
        d = code_dict(c)
        w.writerow([d["serial"], d["masked"], d["session"], d["term"] or "Any", d["status"], d["use_count"], d["max_uses"],
                    d["expires_at"].isoformat() if d["expires_at"] else "", d["student_no"] or "", d["batch_ref"], d["created_at"].isoformat()])
    audit(db, request, user, "RESULT_CODE_EXPORT", "result_code", None, {"rows": len(rows)})
    db.commit()
    return Response(out.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="result-codes.csv"'})


@router.put("/{code_id}")
def update_code(code_id: int, body: CodeUpdateIn, request: Request, db: DB, user: User = Depends(manage)):
    c = get_or_404(db, ResultAccessCode, code_id, "Code")
    d = body.model_dump(exclude_unset=True)
    if body.is_active is not None:
        c.is_active = body.is_active
    if body.max_uses is not None:
        if body.max_uses < c.use_count:
            raise HTTPException(422, "Usage limit cannot be lower than the number of uses already recorded")
        c.max_uses = body.max_uses
    if body.clear_expiry:
        c.expires_at = None
    elif body.expires_at is not None:
        c.expires_at = body.expires_at
    if body.clear_student:
        if c.use_count:
            raise HTTPException(409, "A code that has been used cannot be unassigned")
        c.student_id = None
    elif body.student_id is not None:
        if not db.get(Student, body.student_id):
            raise HTTPException(422, "Selected student does not exist")
        if c.student_id and c.student_id != body.student_id and c.use_count:
            raise HTTPException(409, "This code is already bound to another student")
        c.student_id = body.student_id
    audit(db, request, user, "RESULT_CODE_UPDATE", "result_code", c.id, {"fields": sorted(d)})
    db.commit()
    return code_dict(db.scalars(select(ResultAccessCode).where(ResultAccessCode.id == c.id).options(*_OPTS)).unique().one())


@router.get("/{code_id}/logs")
def code_logs(code_id: int, db: DB, _: User = Depends(manage)):
    get_or_404(db, ResultAccessCode, code_id, "Code")
    logs = db.scalars(select(ResultAccessLog).where(ResultAccessLog.code_id == code_id).order_by(ResultAccessLog.id.desc()).limit(200)).all()
    return [
        {"id": x.id, "success": x.success, "reason": x.reason, "ip": x.ip, "user_agent": x.user_agent,
         "student_ref": x.ref, "created_at": x.created_at}
        for x in logs
    ]


@router.post("/cards.pdf", dependencies=[Depends(rate_limit("cards", 20, 60))])
def cards(body: CardsPdfIn, request: Request, db: DB, user: User = Depends(manage)):
    school = access.get_school(db)
    verified = []
    for c in body.cards:
        serial, pin = (c.get("serial") or "").strip(), (c.get("pin") or "").strip()
        row = db.scalars(select(ResultAccessCode).where(ResultAccessCode.serial == serial).options(*_OPTS)).unique().first()
        if not row or row.code_hash != hash_code(pin):
            raise HTTPException(400, f"Serial {serial or '?'} does not match the supplied PIN")
        verified.append({"serial": row.serial, "pin": pin.upper(), "session": row.session.name, "term": row.term.name if row.term else ""})
    logo = None
    if school.logo_key:
        try:
            logo = get_storage().read(school.logo_key)
        except Exception:
            logo = None
    data = cards_pdf(verified, school, logo, school.website or "")
    audit(db, request, user, "RESULT_CODE_PRINT", "result_code", None, {"cards": len(verified)})
    db.commit()
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="result-cards.pdf"', "Cache-Control": "no-store"})
