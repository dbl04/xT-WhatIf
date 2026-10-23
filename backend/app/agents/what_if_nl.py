"""
Natural-Language What-If Tactical Interpreter & Executor for xT-WhatIf.

Requirement:
"Si da tiempo: what-if en lenguaje natural ('¿y si el lateral cierra por dentro?')
usando las mismas herramientas."

Supports queries in Spanish and English such as:
- "¿y si el lateral cierra por dentro?"
- "¿y si el central adelanta la línea 4 metros?"
- "¿y si el mediocentro sale a presionar al pasador?"
- "what if the full-back tucks inside?"
- "what if #5 steps up to press?"

Translates the tactical query into a legal coordinate adjustment within the 6.0m inertia ring,
executes the same engine tools (`xt_at`, `simulate_counterfactual`, `optimizer/solve`),
and produces a verified multi-agent debate between Dr. Voronoi and Coach Bianchi.
"""

from __future__ import annotations

import re
import math
import logging
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter

from app.schemas.match_contract import MatchFramePayload, PlayerNode, TeamSide
from app.services.tactical_math import simulate_counterfactual as engine_simulate_counterfactual
from app.services.narration import DEFAULT_AUDIENCE, DEFAULT_LANGUAGE, normalize_audience, normalize_language
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.agents.tools import EngineToolRegistry, resolve_frame
from app.agents.orchestrator import DialecticalAgentOrchestrator

logger = logging.getLogger("xtwhatif.agents.what_if")

router = APIRouter(tags=["agents"])


class InterpretedWhatIfMove(BaseModel):
    player_id: int
    player_name: str
    jersey_number: int
    team: TeamSide
    tactical_role: str
    from_x: float
    from_y: float
    to_x: float
    to_y: float
    displacement_m: float
    interpretation: str


class WhatIfNLRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=400, description="Natural-language tactical question")
    match_id: int = DEFAULT_MATCH_ID
    event_uuid: Optional[str] = None
    language: Literal["en", "es"] = DEFAULT_LANGUAGE
    audience: Literal["casual", "analyst", "coach", "audio_description"] = DEFAULT_AUDIENCE


class WhatIfNLResponse(BaseModel):
    query: str
    interpreted_move: InterpretedWhatIfMove
    simulated_frame: MatchFramePayload
    tool_calls: List[Dict[str, Any]]
    verdict_summary: str


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, float(val)))


def interpret_natural_language_move(
    query: str,
    frame: MatchFramePayload,
    language: str = "es",
) -> InterpretedWhatIfMove:
    """
    Deterministically parses a Spanish or English football tactical question
    (e.g. "¿y si el lateral cierra por dentro?") into a concrete player coordinate shift
    within the 6.0m physical inertia envelope.
    """
    q = query.lower().strip()
    lang = normalize_language(language)

    defending_team = TeamSide.AWAY if frame.possession_team == TeamSide.HOME else TeamSide.HOME
    attacking_team = frame.possession_team

    # Determine whether query targets an attacker or a defender (defaults to defending team)
    is_attack_query = any(
        kw in q for kw in ("extremo", "delantero", "atacante", "punta", "nueve", "winger", "striker", "forward")
    )
    target_team = attacking_team if is_attack_query else defending_team
    outfield = [p for p in frame.players if p.team == target_team and not p.is_keeper]
    if not outfield:
        outfield = [p for p in frame.players if not p.is_keeper]

    chosen: Optional[PlayerNode] = None
    role_label = "Defensor" if lang == "es" else "Defender"

    # 1. Check explicit jersey number (#5, dorsal 5, number 5)
    jersey_match = re.search(r"(?:#|dorsal\s+|number\s+|n[úu]mero\s+)(\d{1,2})\b", q)
    if jersey_match:
        j_num = int(jersey_match.group(1))
        chosen = next((p for p in frame.players if p.jersey_number == j_num), None)
        if chosen:
            role_label = f"#{chosen.jersey_number}"

    # 2. Check explicit player name substring
    if chosen is None:
        for p in frame.players:
            surname = p.name.split()[-1].lower()
            if len(surname) >= 3 and surname in q:
                chosen = p
                role_label = p.name
                break

    # 3. Check tactical role keywords
    if chosen is None:
        if any(k in q for k in ("lateral", "carrilero", "full-back", "fullback", "wing-back", "wingback")):
            role_label = "Lateral" if lang == "es" else "Full-back"
            if any(k in q for k in ("derech", "right")):
                chosen = min(outfield, key=lambda p: p.y)
            elif any(k in q for k in ("izquierd", "left")):
                chosen = max(outfield, key=lambda p: p.y)
            else:
                # Pick wide defender on the ball's flank (or widest overall)
                wide_defs = sorted(outfield, key=lambda p: abs(p.y - 40.0), reverse=True)[:2]
                chosen = min(wide_defs, key=lambda p: abs(p.y - frame.ball_y))
        elif any(k in q for k in ("central", "zaguero", "centre-back", "center-back")):
            role_label = "Central" if lang == "es" else "Centre-back"
            central_defs = [p for p in outfield if 22.0 <= p.y <= 58.0] or outfield
            chosen = min(central_defs, key=lambda p: math.hypot(p.x - frame.ball_x, p.y - frame.ball_y))
        elif any(k in q for k in ("pivote", "mediocentro", "volante", "medio", "midfielder", "holding")):
            role_label = "Mediocentro" if lang == "es" else "Holding Midfielder"
            # Defenders further from their own goal line (x=120) act as midfielders
            mid_sorted = sorted(outfield, key=lambda p: p.x)
            chosen = mid_sorted[0]
        elif is_attack_query:
            role_label = "Atacante" if lang == "es" else "Attacker"
            non_actors = [p for p in outfield if not p.is_actor] or outfield
            if any(k in q for k in ("extremo", "banda", "winger")):
                chosen = max(non_actors, key=lambda p: abs(p.y - 40.0))
            else:
                chosen = max(non_actors, key=lambda p: p.x)
        else:
            # Default: defender closest to the ball or passing lane
            chosen = min(outfield, key=lambda p: math.hypot(p.x - frame.ball_x, p.y - frame.ball_y))

    # 4. Parse distance in meters if specified (default 4.2m, max 5.8m within 6.0m inertia ring)
    dist_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:m\b|metros|metres|meters)", q)
    target_dist = min(5.8, max(1.5, float(dist_match.group(1)))) if dist_match else 4.2

    orig_x = chosen.original_x if chosen.original_x is not None else chosen.x
    orig_y = chosen.original_y if chosen.original_y is not None else chosen.y

    # 5. Parse directional vector (dx, dy)
    ux, uy = 0.0, 0.0
    action_desc_es = "ajuste posicional táctico"
    action_desc_en = "tactical positional shift"

    if any(k in q for k in ("dentro", "interior", "centro", "intervalo", "inside", "inward", "half-space", "tuck")):
        # Close inside toward the central axis (y = 40.0) and slightly screen the pass lane
        dy_dir = 1.0 if chosen.y < 40.0 else -1.0
        focal_x = frame.ball_end_x if frame.ball_end_x is not None else frame.ball_x
        dx_dir = 0.35 if focal_x > chosen.x else -0.35
        norm = math.hypot(dx_dir, dy_dir)
        ux, uy = dx_dir / norm, dy_dir / norm
        action_desc_es = "cierra por dentro hacia el carril interior"
        action_desc_en = "tucks inside into the half-space channel"
    elif any(k in q for k in ("banda", "fuera", "abre", "wide", "outside", "touchline")):
        dy_dir = -1.0 if chosen.y < 40.0 else 1.0
        ux, uy = 0.0, dy_dir
        action_desc_es = "bascula hacia la banda exterior"
        action_desc_en = "shifts wide towards the touchline"
    elif any(k in q for k in ("presion", "encima", "acosa", "achica", "press", "step up", "steps up", "jump")):
        dx = frame.ball_x - chosen.x
        dy = frame.ball_y - chosen.y
        norm = max(0.1, math.hypot(dx, dy))
        ux, uy = dx / norm, dy / norm
        action_desc_es = "sale a presionar al poseedor del balón"
        action_desc_en = "steps out to press the ball carrier"
    elif any(k in q for k in ("adelant", "sube", "arriba", "forward", "higher")):
        ux = -1.0 if chosen.team == TeamSide.AWAY else 1.0
        uy = 0.0
        action_desc_es = "adelanta la línea defensiva"
        action_desc_en = "steps the defensive line higher"
    elif any(k in q for k in ("recula", "retrocede", "hunde", "atrás", "atras", "drop", "deeper", "back")):
        ux = 1.0 if chosen.team == TeamSide.AWAY else -1.0
        uy = 0.0
        action_desc_es = "recula hacia su propia área"
        action_desc_en = "drops deeper towards the penalty area"
    else:
        # Default: move towards the active pass target / lane midpoint
        dest_x = frame.ball_end_x if frame.ball_end_x is not None else frame.ball_x
        dest_y = frame.ball_end_y if frame.ball_end_y is not None else 40.0
        mid_x = 0.6 * dest_x + 0.4 * frame.ball_x
        mid_y = 0.6 * dest_y + 0.4 * frame.ball_y
        dx, dy = mid_x - chosen.x, mid_y - chosen.y
        norm = max(0.1, math.hypot(dx, dy))
        ux, uy = dx / norm, dy / norm
        action_desc_es = "cierra la línea de pase principal"
        action_desc_en = "closes the primary passing lane"

    to_x = _clamp(round(orig_x + ux * target_dist, 1), 1.0, 119.0)
    to_y = _clamp(round(orig_y + uy * target_dist, 1), 1.0, 79.0)
    actual_disp = round(math.hypot(to_x - orig_x, to_y - orig_y), 1)

    if lang == "es":
        interp = (
            f"{role_label} {chosen.name} (#{chosen.jersey_number}) {action_desc_es} "
            f"({actual_disp:.1f} m de ({orig_x:.1f}, {orig_y:.1f}) a ({to_x:.1f}, {to_y:.1f}))."
        )
    else:
        interp = (
            f"{role_label} {chosen.name} (#{chosen.jersey_number}) {action_desc_en} "
            f"({actual_disp:.1f} m from ({orig_x:.1f}, {orig_y:.1f}) to ({to_x:.1f}, {to_y:.1f}))."
        )

    return InterpretedWhatIfMove(
        player_id=chosen.player_id,
        player_name=chosen.name,
        jersey_number=chosen.jersey_number,
        team=chosen.team,
        tactical_role=role_label,
        from_x=round(orig_x, 1),
        from_y=round(orig_y, 1),
        to_x=to_x,
        to_y=to_y,
        displacement_m=actual_disp,
        interpretation=interp,
    )


async def execute_natural_language_what_if(
    request: WhatIfNLRequest,
    orchestrator: Optional[DialecticalAgentOrchestrator] = None,
) -> WhatIfNLResponse:
    """
    Executes a natural-language what-if scenario end-to-end using the engine tools
    (`xt_at`, `simulate_counterfactual`, `optimizer/solve`) and generates the verified
    dialectical debate between Dr. Voronoi and Coach Bianchi.
    """
    lang = normalize_language(request.language)
    aud = normalize_audience(request.audience)
    base_frame = resolve_frame(match_id=request.match_id, event_uuid=request.event_uuid)

    move = interpret_natural_language_move(request.query, base_frame, lang)

    # 1. Execute engine tools via EngineToolRegistry
    registry = EngineToolRegistry(bound_frame=base_frame)
    await registry.xt_at(x=move.to_x, y=move.to_y, language=lang, caller_agent="what-if-nl")
    await registry.simulate_counterfactual(
        modified_players=[{"player_id": move.player_id, "x": move.to_x, "y": move.to_y}],
        event_uuid=base_frame.event_uuid,
        include_bound_modifications=False,
        caller_agent="what-if-nl",
    )
    await registry.optimizer_solve(
        max_defenders_to_move=2,
        max_radius_meters=5.8,
        event_uuid=base_frame.event_uuid,
        caller_agent="what-if-nl",
    )

    # 2. Build the simulated MatchFramePayload
    target_player = next(p for p in base_frame.players if p.player_id == move.player_id)
    mod_node = target_player.model_copy(
        update={
            "x": move.to_x,
            "y": move.to_y,
            "original_x": move.from_x,
            "original_y": move.from_y,
            "is_modified": True,
        }
    )
    simulated_frame = engine_simulate_counterfactual(base_frame, [mod_node])

    # 3. Run the Dialectical Multi-Agent Orchestrator (with deterministic numerical verification)
    orch = orchestrator or DialecticalAgentOrchestrator()
    debate_report = await orch.run_debate(simulated_frame, language=lang, audience=aud)
    simulated_frame.agent_debate = debate_report.messages

    all_tools = [t.to_dict() for t in registry.trace]
    verdict_summary = debate_report.verdict.summary if debate_report.verdict else move.interpretation

    return WhatIfNLResponse(
        query=request.query,
        interpreted_move=move,
        simulated_frame=simulated_frame,
        tool_calls=all_tools,
        verdict_summary=verdict_summary,
    )


@router.post("/api/v1/agents/what-if", response_model=WhatIfNLResponse)
@router.post("/api/v1/what-if", response_model=WhatIfNLResponse)
async def what_if_endpoint(request: WhatIfNLRequest) -> WhatIfNLResponse:
    """HTTP endpoint for natural-language tactical what-if simulations."""
    from app.services.agent_swarm import swarm
    return await swarm.run_natural_language_what_if(request)
