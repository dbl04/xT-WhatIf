from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class AgentRole(str, Enum):
    DATA_SCIENTIST = "data_scientist"
    CLASSIC_COACH = "classic_coach"


class TeamSide(str, Enum):
    HOME = "home"
    AWAY = "away"


class PlayerNode(BaseModel):
    player_id: int
    name: str
    jersey_number: int = Field(default=0)
    team: TeamSide
    is_actor: bool = False
    is_keeper: bool = False
    x: float = Field(..., ge=0.0, le=120.0)
    y: float = Field(..., ge=0.0, le=80.0)
    original_x: Optional[float] = None
    original_y: Optional[float] = None
    is_modified: bool = False


class TacticalMetrics(BaseModel):
    original_xt: float
    simulated_xt: float
    xt_delta: float
    space_control_home_pct: float
    optimal_pass_target_id: Optional[int] = None
    pass_completion_prob: float


class AgentMessage(BaseModel):
    message_id: str
    agent_role: AgentRole
    agent_name: str
    avatar_badge: str
    timestamp_label: str
    headline: str
    analysis_body: str
    referenced_metric: str
    highlighted_player_ids: List[int] = Field(default_factory=list)


class MatchFramePayload(BaseModel):
    match_id: int
    event_uuid: str
    minute: int
    second: int
    event_type: str
    possession_team: TeamSide
    is_counterfactual_mode: bool = False
    ball_x: float
    ball_y: float
    ball_end_x: Optional[float] = None
    ball_end_y: Optional[float] = None
    players: List[PlayerNode]
    metrics: TacticalMetrics
    agent_debate: List[AgentMessage]


class CounterfactualRequest(BaseModel):
    match_id: int
    event_uuid: str
    modified_players: List[PlayerNode]
