import io
import socket
import struct
import zipfile

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings

settings = get_settings()

BLOCKED_EXTENSIONS = {
    "exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "vbe", "js", "jse", "jar", "sh",
    "php", "py", "pl", "rb", "html", "htm", "svg", "xml", "hta", "lnk", "apk", "dmg", "app", "docm",
    "xlsm", "pptm", "reg", "cpl", "wsf",
}

# ext -> (kind, allowed declared MIME types, stored MIME)
MATERIAL_TYPES: dict[str, tuple[str, set[str], str]] = {
    "pdf": ("PDF", {"application/pdf"}, "application/pdf"),
    "doc": ("DOCUMENT", {"application/msword"}, "application/msword"),
    "docx": (
        "DOCUMENT",
        {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "ppt": ("PRESENTATION", {"application/vnd.ms-powerpoint"}, "application/vnd.ms-powerpoint"),
    "pptx": (
        "PRESENTATION",
        {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    "xls": ("DOCUMENT", {"application/vnd.ms-excel"}, "application/vnd.ms-excel"),
    "xlsx": (
        "DOCUMENT",
        {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "txt": ("TEXT", {"text/plain"}, "text/plain; charset=utf-8"),
    "jpg": ("IMAGE", {"image/jpeg"}, "image/jpeg"),
    "jpeg": ("IMAGE", {"image/jpeg"}, "image/jpeg"),
    "png": ("IMAGE", {"image/png"}, "image/png"),
    "gif": ("IMAGE", {"image/gif"}, "image/gif"),
    "webp": ("IMAGE", {"image/webp"}, "image/webp"),
    "mp4": ("VIDEO", {"video/mp4"}, "video/mp4"),
    "webm": ("VIDEO", {"video/webm"}, "video/webm"),
    "mp3": ("AUDIO", {"audio/mpeg", "audio/mp3"}, "audio/mpeg"),
    "wav": ("AUDIO", {"audio/wav", "audio/x-wav", "audio/wave"}, "audio/wav"),
    "m4a": ("AUDIO", {"audio/mp4", "audio/x-m4a", "audio/m4a"}, "audio/mp4"),
    "ogg": ("AUDIO", {"audio/ogg"}, "audio/ogg"),
}
MATERIAL_KINDS = {
    "PDF", "DOCUMENT", "PRESENTATION", "IMAGE", "VIDEO", "AUDIO", "TEXT",
    "PAST_QUESTION", "ASSIGNMENT", "NOTE",
}
INLINE_OK_MIMES = ("application/pdf", "image/", "video/", "audio/", "text/plain")

PHOTO_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
ASSET_TYPES = PHOTO_TYPES


def _ext(filename: str) -> str:
    name = (filename or "").lower().strip()
    parts = name.split(".")
    if len(parts) < 2:
        raise HTTPException(422, "File must have an extension")
    if any(p in BLOCKED_EXTENSIONS for p in parts[1:]):
        raise HTTPException(422, "This file type is not allowed")
    return parts[-1]


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while chunk := await file.read(1024 * 256):
        buf += chunk
        if len(buf) > max_bytes:
            raise HTTPException(413, f"File too large (max {max_bytes // (1024 * 1024)} MB)")
    if not buf:
        raise HTTPException(422, "Empty file")
    return bytes(buf)


def _magic_ok(ext: str, d: bytes) -> bool:
    if ext == "pdf":
        return d[:5] == b"%PDF-"
    if ext in ("doc", "ppt", "xls"):
        return d[:8] == bytes.fromhex("D0CF11E0A1B11AE1")
    if ext in ("docx", "pptx", "xlsx"):
        if d[:4] != b"PK\x03\x04":
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(d)) as z:
                names = z.namelist()
        except zipfile.BadZipFile:
            return False
        if any("vbaProject" in n for n in names):
            return False
        expected = {"docx": "word/", "pptx": "ppt/", "xlsx": "xl/"}[ext]
        return any(n.startswith(expected) for n in names)
    if ext in ("jpg", "jpeg"):
        return d[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return d[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == "gif":
        return d[:6] in (b"GIF87a", b"GIF89a")
    if ext == "webp":
        return d[:4] == b"RIFF" and d[8:12] == b"WEBP"
    if ext in ("mp4", "m4a"):
        return d[4:8] == b"ftyp"
    if ext == "webm":
        return d[:4] == bytes.fromhex("1A45DFA3")
    if ext == "mp3":
        return d[:3] == b"ID3" or (len(d) > 1 and d[0] == 0xFF and (d[1] & 0xE0) == 0xE0)
    if ext == "wav":
        return d[:4] == b"RIFF" and d[8:12] == b"WAVE"
    if ext == "ogg":
        return d[:4] == b"OggS"
    if ext == "txt":
        try:
            d.decode("utf-8")
            return b"\x00" not in d
        except UnicodeDecodeError:
            return False
    return False


def scan_upload(data: bytes) -> None:
    """Optional ClamAV scan via INSTREAM; no-op when CLAMAV_HOST is unset."""
    host = getattr(settings, "clamav_host", "")
    if not host:
        return
    try:
        with socket.create_connection((host, settings.clamav_port), timeout=10) as s:
            s.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 8192):
                chunk = data[i : i + 8192]
                s.sendall(struct.pack("!I", len(chunk)) + chunk)
            s.sendall(struct.pack("!I", 0))
            reply = s.recv(1024)
    except OSError:
        raise HTTPException(503, "Upload scanning unavailable. Try again later.")
    if b"FOUND" in reply:
        raise HTTPException(422, "File rejected by security scan")


async def validate_material(file: UploadFile) -> tuple[bytes, str, str, str, str]:
    """Returns (data, ext, kind, stored_mime, safe_filename)."""
    ext = _ext(file.filename or "")
    if ext not in MATERIAL_TYPES:
        raise HTTPException(422, f"File type .{ext} is not supported")
    kind, declared_ok, stored_mime = MATERIAL_TYPES[ext]
    declared = (file.content_type or "").split(";")[0].strip().lower()
    if declared not in declared_ok:
        raise HTTPException(422, "File content type does not match its extension")
    mb = settings.max_upload_mb * (4 if kind in ("VIDEO", "AUDIO") else 1)
    data = await _read_limited(file, mb * 1024 * 1024)
    if not _magic_ok(ext, data):
        raise HTTPException(422, "File content does not match its extension")
    scan_upload(data)
    safe = "".join(c for c in (file.filename or "file") if c.isalnum() or c in "._- ")[:150] or f"file.{ext}"
    return data, ext, kind, stored_mime, safe


async def process_image(file: UploadFile, max_side: int, max_mb: int = 5, allow_png: bool = False) -> tuple[bytes, str, str]:
    """Validates and re-encodes an image (strips metadata). Returns (bytes, ext, mime)."""
    ext = _ext(file.filename or "")
    if ext not in PHOTO_TYPES:
        raise HTTPException(422, "Only JPG, PNG or WEBP images are allowed")
    declared = (file.content_type or "").split(";")[0].strip().lower()
    if declared != PHOTO_TYPES[ext]:
        raise HTTPException(422, "Image content type does not match its extension")
    data = await _read_limited(file, max_mb * 1024 * 1024)
    if not _magic_ok(ext, data):
        raise HTTPException(422, "File content does not match its extension")
    scan_upload(data)
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "Invalid image file")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    if allow_png and (img.mode in ("RGBA", "LA", "P")):
        img.convert("RGBA").save(out, "PNG", optimize=True)
        return out.getvalue(), "png", "image/png"
    img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue(), "jpg", "image/jpeg"
