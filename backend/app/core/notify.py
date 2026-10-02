import logging
import smtplib
from collections.abc import Iterable
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Notification, User

log = logging.getLogger("school.notify")
settings = get_settings()


def notify(db: Session, user_ids: Iterable[int], title: str, message: str, link: str | None = None) -> None:
    for uid in set(user_ids):
        db.add(Notification(user_id=uid, title=title[:200], message=message[:500], link=link))


def notify_roles(db: Session, roles: Iterable[str], title: str, message: str, link: str | None = None) -> None:
    ids = db.scalars(select(User.id).where(User.role.in_(list(roles)), User.is_active.is_(True))).all()
    notify(db, ids, title, message, link)


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        log.info("EMAIL (SMTP not configured) to=%s subject=%s\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    except Exception:  # never let mail failure break the request
        log.exception("Failed to send email to %s", to)
