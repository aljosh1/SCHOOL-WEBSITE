from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import GradeEntry, GradingScale

DEFAULT_SCALE = [
    # grade, description, min, max, point, teacher remark, principal remark
    ("A", "Excellent", 70, 100, 5.0, "An outstanding performance. Keep it up.", "Excellent result. Well done."),
    ("B", "Very Good", 60, 69, 4.0, "A very good performance. Aim higher.", "Very good result. Keep working hard."),
    ("C", "Good", 50, 59, 3.0, "A good effort. More focus will help.", "Good result. There is room for improvement."),
    ("D", "Pass", 45, 49, 2.0, "A fair result. Needs more effort.", "A fair result. Put in more effort."),
    ("E", "Weak Pass", 40, 44, 1.0, "A weak pass. Serious work is needed.", "Weak result. Greater commitment required."),
    ("F", "Fail", 0, 39, 0.0, "Below the pass mark. Must work much harder.", "Unsatisfactory. Urgent improvement needed."),
]


def active_entries(db: Session) -> list[GradeEntry]:
    scale = db.scalars(select(GradingScale).where(GradingScale.is_active.is_(True)).limit(1)).first()
    if not scale:
        return []
    return sorted(scale.entries, key=lambda e: e.min_score, reverse=True)


def grade_for(entries: list[GradeEntry], total: float) -> GradeEntry | None:
    """Fractional scores that fall between two bands take the lower band."""
    for e in entries:
        if e.min_score <= total <= e.max_score:
            return e
    for e in entries:
        if total >= e.min_score:
            return e
    return entries[-1] if entries else None


def validate_scale(entries: list[tuple[float, float]], top: float) -> None:
    ordered = sorted(entries)
    if ordered[0][0] != 0:
        raise HTTPException(422, "The lowest grade band must start at 0")
    for (_, prev_max), (nxt_min, _) in zip(ordered, ordered[1:]):
        if nxt_min <= prev_max:
            raise HTTPException(422, "Grade bands must not overlap")
        if nxt_min > prev_max + 1:
            raise HTTPException(422, f"Gap in grade bands between {prev_max} and {nxt_min}")
    if ordered[-1][1] < top:
        raise HTTPException(422, f"The highest grade band must reach {top:g}")


def install_default_scale(db: Session) -> GradingScale:
    scale = GradingScale(name="Standard (A-F)", is_active=True)
    for g, d, lo, hi, gp, tr, pr in DEFAULT_SCALE:
        scale.entries.append(
            GradeEntry(grade=g, description=d, min_score=lo, max_score=hi, grade_point=gp, remark=tr, principal_remark=pr)
        )
    db.add(scale)
    db.flush()
    return scale
