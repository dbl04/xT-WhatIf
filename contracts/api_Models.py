from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
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


class TeamInfo(BaseModel):
    name: str
    short_name: str = Field(..., min_length=2, max_length=4)
    primary_color: str


class MatchInfo(BaseModel):
    """Fixture metadata. All data in this project is synthetic (fictional clubs and players)."""
    competition: str
    venue: str
    home: TeamInfo
    away: TeamInfo
    data_source: str = "synthetic"
    seed: Optional[int] = None


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
    players: List[PlayerNode] = Field(..., max_length=30)
    metrics: TacticalMetrics
    agent_debate: List[AgentMessage]
    # Human-readable name of the moment, e.g. "Cut-back from the byline" (in the requested language).
    moment_label: Optional[str] = None
    # Stable scenario key of the moment (e.g. "cutback"), used to localise moment_label.
    moment_key: Optional[str] = None
    match_info: Optional[MatchInfo] = None


class CounterfactualRequest(BaseModel):
    match_id: int
    event_uuid: str = Field(..., max_length=64)
    modified_players: List[PlayerNode] = Field(..., min_length=1, max_length=22)
    # Personalisation of the agents' debate (see app/services/narration.py).
    language: Literal["en", "es"] = "en"
    audience: Literal["casual", "analyst", "coach", "audio_description"] = "analyst"

class StressBurstResponse(BaseModel):
    """POST /api/v1/cloud/stress-burst. The frontend reads these names as they are."""
    status: str
    benchmark: str
    simulations_count: int
    total_time_ms: float
    average_latency_ms: float
    throughput_simulations_per_sec: float
    kd_tree_lookups: int
    engine: str
    active_instance_id: str
    aca_gateway_replicas: int
    # A number, or a text label while the chaos test has the AKS workers unreachable.
    aks_worker_pods: Union[int, str]
    estimated_cpu_utilization_pct: float
    sampled_simulated_xt: List[float]
    metrics: Dict[str, Any]
