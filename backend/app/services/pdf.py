import io
from datetime import date
from xml.sax.saxutils import escape

import qrcode
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import SchoolSettings

_styles = getSampleStyleSheet()


def _p(text: str, size: float = 9, bold: bool = False, align=0, color=colors.black, leading: float | None = None):
    st = ParagraphStyle(
        "x",
        parent=_styles["Normal"],
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.25,
        alignment=align,
        textColor=color,
    )
    return Paragraph(escape(text or ""), st)


def _img(data: bytes | None, w: float, h: float):
    if not data:
        return Spacer(1, 1)
    try:
        reader = ImageReader(io.BytesIO(data))
        iw, ih = reader.getSize()
        scale = min(w / iw, h / ih)
        return Image(io.BytesIO(data), width=iw * scale, height=ih * scale)
    except Exception:
        return Spacer(1, 1)


def qr_png(url: str) -> bytes:
    img = qrcode.make(url, box_size=6, border=1)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _fmt(v: float | None) -> str:
    if v is None:
        return "-"
    return f"{v:g}" if float(v).is_integer() else f"{v:.1f}"


def report_card_pdf(
    report: dict,
    school: SchoolSettings,
    photo: bytes | None,
    logo: bytes | None,
    stamp: bytes | None,
    signature: bytes | None,
    verify_url: str,
) -> bytes:
    primary = colors.HexColor(school.primary_color or "#14532d")
    light = colors.Color(primary.red, primary.green, primary.blue, alpha=0.08)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
        title=f"Report Card - {report['student']['name']}", author=school.name,
    )
    W = A4[0] - 24 * mm
    s = report["summary"]
    st = report["student"]
    story: list = []

    contact = " | ".join(x for x in (school.phone, school.email, school.website) if x)
    header = Table(
        [[
            _img(logo, 22 * mm, 22 * mm),
            [
                _p(school.name.upper(), 15, True, TA_CENTER, primary),
                _p(school.motto or "", 8.5, False, TA_CENTER, colors.grey),
                _p(school.address or "", 8, False, TA_CENTER),
                _p(contact, 8, False, TA_CENTER),
            ],
            _img(photo, 24 * mm, 28 * mm),
        ]],
        colWidths=[26 * mm, W - 54 * mm, 28 * mm],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [header]

    banner = Table(
        [[_p(f"STUDENT REPORT CARD  -  {report['term'].upper()}  -  {report['session']} SESSION", 10.5, True, TA_CENTER, colors.white)]],
        colWidths=[W],
    )
    banner.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), primary), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [Spacer(1, 3), banner, Spacer(1, 6)]

    def kv(k, v):
        return [_p(k, 8, True, color=colors.grey), _p(str(v or "-"), 9, True)]

    info = Table(
        [
            kv("Student Name", st["name"]) + kv("Student ID", st["student_no"]),
            kv("Class", report["class_name"]) + kv("Admission No.", st["admission_no"]),
            kv("Gender", (st["gender"] or "").title()) + kv("Class Size", s["class_size"]),
            kv("Next Term Begins", report["next_term_begins"] or "-") + kv("Report Reference", report["verification_ref"]),
        ],
        colWidths=[30 * mm, W / 2 - 30 * mm, 30 * mm, W / 2 - 30 * mm],
    )
    info.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, primary), ("BACKGROUND", (0, 0), (-1, -1), light),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story += [info, Spacer(1, 8)]

    show_pos = any(x["position_label"] for x in report["subjects"])
    head = ["SUBJECT", f"CA\n({_fmt(report['ca_max'])})", f"EXAM\n({_fmt(report['exam_max'])})", f"TOTAL\n({_fmt(report['total_max'])})", "GRADE", "REMARK"]
    widths = [50 * mm, 17 * mm, 17 * mm, 17 * mm, 15 * mm]
    if show_pos:
        head.insert(5, "POS.")
        widths.append(15 * mm)
    widths.append(W - sum(widths))
    rows = [[_p(h, 7.5, True, TA_CENTER, colors.white) for h in head]]
    for x in report["subjects"]:
        row = [
            _p(x["subject"], 8.5, True),
            _p(_fmt(x["ca_score"]), 8.5, False, TA_CENTER),
            _p(_fmt(x["exam_score"]), 8.5, False, TA_CENTER),
            _p(_fmt(x["total"]), 8.5, True, TA_CENTER),
            _p(f"{x['grade'] or '-'}", 8.5, True, TA_CENTER),
        ]
        if show_pos:
            row.append(_p(x["position_label"] or "-", 8.5, False, TA_CENTER))
        row.append(_p(x["grade_description"] or "", 8, False))
        rows.append(row)
    tbl = Table(rows, colWidths=widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), primary), ("GRID", (0, 0), (-1, -1), 0.4, colors.Color(0.75, 0.75, 0.75)),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story += [tbl, Spacer(1, 8)]

    summary_cells = [
        ("Subjects", s["subjects_count"]), ("Total Score", _fmt(s["total_score"])), ("Average", _fmt(s["average"])),
        ("Overall Grade", f"{s['overall_grade'] or '-'}"), ("Position", f"{s['position_label']} of {s['class_size']}" if s["position_label"] else "-"),
        ("Class Average", _fmt(s["class_average"])),
    ]
    sm = Table(
        [[_p(k, 7.5, True, TA_CENTER, colors.grey) for k, _ in summary_cells], [_p(str(v), 11, True, TA_CENTER, primary) for _, v in summary_cells]],
        colWidths=[W / len(summary_cells)] * len(summary_cells),
    )
    sm.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, primary), ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.lightgrey), ("BACKGROUND", (0, 0), (-1, 0), light)]))
    story += [sm, Spacer(1, 4)]

    key = "  |  ".join(f"{g['grade']} {_fmt(g['min'])}-{_fmt(g['max'])} {g['description']}" for g in report["grading"])
    story += [_p("Grading key: " + key, 7, False, 0, colors.grey), Spacer(1, 8)]

    remarks = Table(
        [
            [_p("Class Teacher's Remark", 8, True, color=primary), _p(report["teacher_remark"] or "", 9)],
            [_p(f"{school.principal_title or 'Principal'}'s Remark", 8, True, color=primary), _p(report["principal_remark"] or "", 9)],
        ],
        colWidths=[40 * mm, W - 40 * mm],
    )
    remarks.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [remarks, Spacer(1, 10)]

    sign = Table(
        [[
            [_img(signature, 38 * mm, 14 * mm), _p("_" * 34, 8), _p(f"{school.principal_name or ''}", 8.5, True), _p(school.principal_title or "Principal", 8)],
            _img(stamp, 28 * mm, 28 * mm),
            [_img(qr_png(verify_url), 24 * mm, 24 * mm), _p("Scan to verify", 7, False, TA_CENTER, colors.grey)],
        ]],
        colWidths=[W * 0.45, W * 0.25, W * 0.30],
    )
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("ALIGN", (2, 0), (2, 0), "RIGHT")]))
    story += [sign, Spacer(1, 6)]

    footer = f"Issued {date.today().strftime('%d %B %Y')}  |  Ref: {report['verification_ref']}  |  Verify: {verify_url}"
    story += [_p(footer, 7, False, TA_CENTER, colors.grey)]
    if school.result_footer_note:
        story += [_p(school.result_footer_note, 7, False, TA_CENTER, colors.grey)]

    doc.build(story)
    return buf.getvalue()


def cards_pdf(cards: list[dict], school: SchoolSettings, logo: bytes | None, portal_url: str) -> bytes:
    """Prints scratch-card layouts, 2 columns x 4 rows per A4 page."""
    primary = colors.HexColor(school.primary_color or "#14532d")
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Result checking cards")
    pw, ph = A4
    cw, ch = 92 * mm, 64 * mm
    gx, gy = 6 * mm, 4 * mm
    ox = (pw - (2 * cw + gx)) / 2
    oy = (ph - (4 * ch + 3 * gy)) / 2
    logo_reader = None
    if logo:
        try:
            logo_reader = ImageReader(io.BytesIO(logo))
        except Exception:
            logo_reader = None

    def instruction_lines(x, y):
        lines = [
            "1. Visit the school's result portal.",
            "2. Enter your student ID.",
            "3. Enter the access PIN.",
            "4. Select your session and term.",
            "5. View your result.",
        ]
        c.setFont("Helvetica", 6.8)
        c.setFillColor(colors.black)
        for i, ln in enumerate(lines):
            c.drawString(x, y - i * 8.2, ln)

    for i, card in enumerate(cards):
        pos = i % 8
        if i and pos == 0:
            c.showPage()
        col, row = pos % 2, pos // 2
        x = ox + col * (cw + gx)
        y = ph - oy - (row + 1) * ch - row * gy
        c.setStrokeColor(primary)
        c.setLineWidth(1)
        c.setDash(3, 2)
        c.roundRect(x, y, cw, ch, 3 * mm)
        c.setDash()
        c.setFillColor(primary)
        c.rect(x, y + ch - 14 * mm, cw, 14 * mm, stroke=0, fill=1)
        if logo_reader:
            c.drawImage(logo_reader, x + 2 * mm, y + ch - 12.5 * mm, 11 * mm, 11 * mm, preserveAspectRatio=True, mask="auto")
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 8.5)
        name = school.name.upper()
        c.drawString(x + 15 * mm, y + ch - 6 * mm, name[:42])
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(x + 15 * mm, y + ch - 11 * mm, "RESULT CHECKING CARD")
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 7)
        c.drawString(x + 4 * mm, y + ch - 19 * mm, "Serial Number:")
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 4 * mm, y + ch - 24.5 * mm, card.get("serial", ""))
        c.setFont("Helvetica", 7)
        c.drawString(x + 4 * mm, y + ch - 30 * mm, "Access PIN:")
        c.setFillColor(colors.Color(0.93, 0.93, 0.93))
        c.rect(x + 3 * mm, y + ch - 39 * mm, cw - 6 * mm, 7 * mm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Courier-Bold", 13)
        c.drawCentredString(x + cw / 2, y + ch - 37 * mm, card.get("pin", ""))
        instruction_lines(x + 4 * mm, y + ch - 44 * mm)
        c.setFont("Helvetica", 6)
        c.setFillColor(colors.grey)
        meta = " | ".join(v for v in (card.get("session"), card.get("term")) if v)
        c.drawString(x + 4 * mm, y + 3 * mm, f"{meta}   {portal_url}"[:80])
    c.save()
    return buf.getvalue()
