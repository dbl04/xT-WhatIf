"""
HTTP API of the xT Live Challenge game.

POST /api/v1/game/preview — while a user moves players on a key moment: which players they
may move, which rules the current moves break, and an arrow (better / worse / same) for the
user's side. The value V itself and the optimum stay on the server until the reveal.

POST /api/v1/game/optimize — internal AKS worker endpoint that computes the single-mode
`Optimum` (`attack` or `defend`) for a frame. Served only when `SERVICE_ROLE` is `aks-worker`
or `standalone` (404 on public gateway/live roles) and guarded by `X-Worker-Token`.
"""

import asyncio
import secrets
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.schemas.match_contract import MatchFramePayload, TeamSide
from app.services.game_engine import (
    MAX_MOVED_PLAYERS,
    MAX_RADIUS_M,
    MIN_SPACING_M,
    GameMode,
    frame_value,
    mode_for,
    movable_players,
    offside_line,
    optimize,
    optimum_to_dict,
    score_submission,
    validate_moves,
)
from app.services.match_loader import loader
from app.services.narration import (
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    REVEAL_TEXT,
    normalize_audience,
    normalize_language,
    reveal_pundits_and_comparison,
)

router = APIRouter(prefix="/api/v1/game", tags=["game"])

# |change in V| below this reads as "same" (V is a probability-like value around 0.05-0.45).
TREND_EPSILON = 0.002


class MoveIn(BaseModel):
    player_id: int
    x: float = Field(..., ge=-10.0, le=130.0)
    y: float = Field(..., ge=-10.0, le=90.0)


class PreviewRequest(BaseModel):
    match_id: int
    event_uuid: str = Field(..., max_length=64)
    team: TeamSide  # the team the user supports
    moves: List[MoveIn] = Field(default_factory=list, max_length=11)


class EvaluateRequest(BaseModel):
    match_id: int
    event_uuid: str = Field(..., max_length=64)
    team: TeamSide
    moves: List[MoveIn] = Field(default_factory=list, max_length=11)
    language: str = DEFAULT_LANGUAGE
    audience: str = DEFAULT_AUDIENCE


class OptimizeRequest(BaseModel):
    frame: MatchFramePayload
    mode: GameMode


class ViolationOut(BaseModel):
    player_id: int
    rule: str
    detail: str


class GameRules(BaseModel):
    max_players: int = MAX_MOVED_PLAYERS
    max_radius_m: float = MAX_RADIUS_M
    min_spacing_m: float = MIN_SPACING_M
    # Attack only: attackers who start onside may not cross this x (attacking towards x = 120).
    offside_line_x: Optional[float] = None


class PreviewResponse(BaseModel):
    mode: Literal["attack", "defend"]
    movable_player_ids: List[int]
    rules: GameRules
    legal: bool
    violations: List[ViolationOut]
    # Effect of the moves for the user's side; "same" when there are no legal moves.
    trend: Literal["better", "worse", "same"]


def _moment(match_id: int, event_uuid: str) -> MatchFramePayload:
    # A moment of the live match first, then the committed key moments.
    from app.services.live_match import runner  # late import: live_match imports the game engine too

    room = runner.room
    if room is not None and room.match_id == match_id:
        event = next((e for e in room.events if e.frame.event_uuid == event_uuid), None)
        if event is not None:
            return event.frame
    raw = next((f for f in loader.fetch_match_360_frames(match_id) if f["event_uuid"] == event_uuid), None)
    if raw is None:
        raise HTTPException(status_code=404, detail="Key moment not found")
    return MatchFramePayload(**raw)


@router.post("/preview", response_model=PreviewResponse)
async def preview(request: PreviewRequest) -> PreviewResponse:
    frame = _moment(request.match_id, request.event_uuid)
    mode = mode_for(request.team, frame)
    moves = [(m.player_id, round(m.x, 1), round(m.y, 1)) for m in request.moves]
    violations = validate_moves(frame, mode, moves)

    trend: Literal["better", "worse", "same"] = "same"
    if moves and not violations:
        change = frame_value(frame, moves).value - frame_value(frame).value
        if mode == "defend":
            change = -change
        if change > TREND_EPSILON:
            trend = "better"
        elif change < -TREND_EPSILON:
            trend = "worse"

    return PreviewResponse(
        mode=mode,
        movable_player_ids=[p.player_id for p in movable_players(frame, mode)],
        rules=GameRules(offside_line_x=round(offside_line(frame), 1) if mode == "attack" else None),
        legal=not violations,
        violations=[ViolationOut(player_id=v.player_id, rule=v.rule, detail=v.detail) for v in violations],
        trend=trend,
    )


@router.post("/optimize")
async def optimize_mode(
    request: OptimizeRequest,
    x_worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
) -> Dict[str, Any]:
    """
    Computes the single-mode Optimum (`attack` or `defend`) on an AKS worker pod.
    Hidden (404) on public roles (`aca-gateway`, `live`) so external callers cannot burn CPU.
    """
    if settings.SERVICE_ROLE not in ("aks-worker", "standalone"):
        raise HTTPException(status_code=404, detail="Not found")

    expected_token = settings.AKS_WORKER_TOKEN
    if settings.SERVICE_ROLE != "standalone" and not expected_token:
        raise HTTPException(status_code=403, detail="AKS worker token is not configured")

    if expected_token:
        if not x_worker_token or not secrets.compare_digest(x_worker_token, expected_token):
            raise HTTPException(status_code=401, detail="Invalid or missing X-Worker-Token")

    opt = await asyncio.to_thread(optimize, request.frame, request.mode)
    return optimum_to_dict(opt)


@router.post("/evaluate")
async def evaluate_practice_challenge(request: EvaluateRequest) -> Dict[str, Any]:
    """
    Evaluates a user's challenge submission in Practice / Key Moments mode on demand.
    Computes the optimal moves for the supported team, scores the user's legal moves (/1000),
    and builds the audience-personalized MomentReveal payload.
    """
    frame = _moment(request.match_id, request.event_uuid)
    mode = mode_for(request.team, frame)
    lang = normalize_language(request.language)
    aud = normalize_audience(request.audience)

    raw_moves = [(m.player_id, round(m.x, 1), round(m.y, 1)) for m in request.moves]
    violations = validate_moves(frame, mode, raw_moves)
    broken_ids = {v.player_id for v in violations}
    legal_moves = [(pid, x, y) for pid, x, y in raw_moves if pid not in broken_ids]

    opt = await asyncio.to_thread(optimize, frame, mode)
    user_val = frame_value(frame, legal_moves).value
    score, beat_machine = score_submission(opt.mode, opt.base.value, opt.best.value, user_val)

    moment_id = f"practice-{frame.event_uuid}"
    pack = reveal_pundits_and_comparison(
        frame=frame,
        moment_id=moment_id,
        mode=opt.mode,
        opt_moves=opt.moves,
        base_value=opt.base.value,
        best_value=opt.best.value,
        best_target_id=opt.best.target_id,
        user_moves=legal_moves,
        user_value=user_val,
        user_score=score,
        beat_machine=beat_machine,
        lang=lang,
        audience=aud,
    )
    share = 38 if score >= 900 else 24
    text = REVEAL_TEXT[lang]
    return {
        "moment_id": moment_id,
        "mode": opt.mode,
        "optimum_moves": [{"player_id": p, "x": x, "y": y} for p, x, y in opt.moves],
        "optimum_target_id": opt.best.target_id,
        "base_target_id": opt.base.target_id,
        "your_moves": [{"player_id": p, "x": x, "y": y} for p, x, y in legal_moves],
        "your_score": score,
        "beat_machine": beat_machine,
        "goal_chance_pct": {
            "before": round(opt.base.value * 100),
            "best": round(opt.best.value * 100),
            "yours": round(user_val * 100),
        },
        "explanation": {
            "headline": pack["headline"],
            "body": pack["body"],
            "voronoi_comparison": pack["voronoi_comparison"],
            "bianchi_headline": pack["bianchi_headline"],
            "personal": pack["personal"],
            "voronoi_voice": pack["voronoi_voice"],
            "bianchi_voice": pack["bianchi_voice"],
            "community": text["community"].format(share=share),
        },
        "pundits": pack["pundits"],
        "community": {
            "submissions": 1,
            "found_it_pct": share,
            "avg_score": max(520, min(920, round((score + 680) / 2))),
        },
    }
