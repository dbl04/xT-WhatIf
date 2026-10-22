"""
HTTP API of the xT Live Challenge game.

POST /api/v1/game/preview — while a user moves players on a key moment: which players they
may move, which rules the current moves break, and an arrow (better / worse / same) for the
user's side. The value V itself and the optimum stay on the server until the reveal.
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas.match_contract import MatchFramePayload, TeamSide
from app.services.game_engine import (
    MAX_MOVED_PLAYERS,
    MAX_RADIUS_M,
    MIN_SPACING_M,
    frame_value,
    mode_for,
    movable_players,
    offside_line,
    validate_moves,
)
from app.services.match_loader import loader

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
