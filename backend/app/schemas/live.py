"""Contract of the live game (xT Live Challenge): match events and the messages around a key moment."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.match_contract import MatchFramePayload, TeamSide

Outcome = Literal["completed", "intercepted", "goal", "saved", "missed", "blocked"]


class Score(BaseModel):
    home: int = 0
    away: int = 0


class LiveEvent(BaseModel):
    """One event of a full synthetic match, with its freeze-frame and the score after it."""
    index: int
    match_seconds: float  # game clock, 0-5400
    frame: MatchFramePayload
    outcome: Outcome
    score: Score
    # Passed the Detector's rule pre-filter (shot, action into the box, switch, cut-back...).
    candidate: bool = False


class MoveIn(BaseModel):
    player_id: int
    x: float = Field(..., ge=-10.0, le=130.0)
    y: float = Field(..., ge=-10.0, le=90.0)


class SubmitIn(BaseModel):
    """Client -> server: the user's moves for the open key moment."""
    moment_id: str = Field(..., max_length=64)
    moves: List[MoveIn] = Field(default_factory=list, max_length=11)


class Profile(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    nickname: str = Field(..., min_length=1, max_length=24)
    team: TeamSide
    language: Literal["en", "es"] = "en"
    audience: Literal["casual", "analyst", "coach", "audio_description"] = "analyst"
    is_bot: bool = False


class Submission(BaseModel):
    user_id: str
    team: TeamSide
    moves: List[MoveIn]
    value: float
    legal: bool
    submitted_at: float
    score: Optional[int] = None
    beat_machine: bool = False
