import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.core.config import get_settings

settings = get_settings()


def client_ip(request: Request) -> str:
    if settings.trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


class SlidingWindowLimiter:
    """Per-process limiter. Use Redis when running several instances."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            if len(self._hits) > 20000:
                self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def rate_limit(name: str, limit: int, window_seconds: int):
    def dep(request: Request) -> None:
        if not limiter.check(f"{name}:{client_ip(request)}", limit, window_seconds):
            raise HTTPException(429, "Too many requests. Please try again later.")

    return dep
