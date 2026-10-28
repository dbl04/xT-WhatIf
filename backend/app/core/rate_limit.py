"""
Per-client sliding-window rate limiting for the public demo.

The deployed gateway is reachable without authentication until judging ends, and several
routes are expensive: they call Azure OpenAI (debate, TTS) or burn CPU (stress burst,
optimizer). This keeps one client from running up the bill or degrading the demo for others.

State is in memory per replica, which is enough for a demo: each replica enforces its own
budget, so the effective limit scales with the replica count.
"""

import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple

from fastapi import Request
from starlette.responses import JSONResponse

from app.core.config import settings

WINDOW_SECONDS = 60.0

# Route prefix -> requests allowed per client per minute.
ROUTE_LIMITS: Dict[str, int] = {
    "/api/v1/simulate": 60,
    "/api/v1/optimizer/solve": 40,
    # Called while the user drags players during a 30 s challenge.
    "/api/v1/game/preview": 240,
    "/api/v1/game/optimize": 120,
    "/api/v1/tts/synthesize": 30,
    "/api/v1/speech/transcribe": 30,
    # Reveal voice of the live match: one request per moment per fan.
    "/api/v1/live/moments": 30,
    "/api/v1/cloud/stress-burst": 6,
    "/api/v1/cloud/chaos-toggle": 12,
}
# WebSocket SIMULATE_MOVE messages share the /api/v1/simulate budget.
WS_SIMULATE_BUCKET = "/api/v1/simulate"

_hits: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)


def client_key(headers, fallback_host: Optional[str]) -> str:
    """
    Client identity. Behind Azure Container Apps the ingress appends the caller's address to
    X-Forwarded-For, so the last entry is the one added by the trusted proxy (earlier entries
    can be forged by the client).
    """
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return fallback_host or "unknown"


def allow(bucket: str, client: str, now: Optional[float] = None) -> Tuple[bool, int]:
    """Records a hit; returns (allowed, retry_after_seconds)."""
    limit = ROUTE_LIMITS.get(bucket)
    if limit is None or not settings.RATE_LIMIT_ENABLED:
        return True, 0
    now = time.monotonic() if now is None else now
    hits = _hits[(bucket, client)]
    while hits and now - hits[0] >= WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= limit:
        return False, max(1, int(WINDOW_SECONDS - (now - hits[0])) + 1)
    hits.append(now)
    return True, 0


def _bucket_for(path: str) -> Optional[str]:
    for prefix in ROUTE_LIMITS:
        if path.startswith(prefix):
            return prefix
    return None


async def rate_limit_middleware(request: Request, call_next):
    bucket = _bucket_for(request.url.path) if request.method == "POST" else None
    if bucket:
        ok, retry_after = allow(bucket, client_key(request.headers, request.client.host if request.client else None))
        if not ok:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests, please slow down.", "retry_after_s": retry_after},
                headers={"Retry-After": str(retry_after)},
            )
    return await call_next(request)


def reset() -> None:
    """Clears all counters (tests)."""
    _hits.clear()
