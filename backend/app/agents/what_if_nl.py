"""
Natural-Language What-If Tactical Interpreter & Executor for xT-WhatIf.

Requirement:
"Si da tiempo: what-if en lenguaje natural ('¿y si el lateral cierra por dentro?')
usando las mismas herramientas."

Supports single-player and two-player voice/text queries in Spanish and English such as:
- "¿y si el lateral cierra por dentro?"
- "¿y si el central adelanta la línea 4 metros?"
- "¿y si el mediocentro sale a presionar al pasador y el lateral cierra el pase?"
- "what if the full-back tucks inside?"
- "what if #5 steps up to press and #4 drops deeper?"

Translates the tactical query into up to 2 legal coordinate adjustments within the 6.0m inertia ring,
executes the same engine tools (`xt_at`, `simulate_counterfactual`, `optimizer/solve`),
and produces a verified multi-agent debate between Dr. Voronoi and Coach Bianchi.
"""

from __future__ import annotations

import re
import math
import logging
import unicodedata
from typing import Any, Dict, List, Literal, Optional, Set
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

MAX_VOICE_MOVES = 2


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


class ExistingPlayerMove(BaseModel):
    player_id: int
    x: float
    y: float
    original_x: Optional[float] = None
    original_y: Optional[float] = None


class WhatIfNLRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=400, description="Natural-language tactical question")
    match_id: int = DEFAULT_MATCH_ID
    event_uuid: Optional[str] = None
    language: Literal["en", "es"] = DEFAULT_LANGUAGE
    audience: Literal["casual", "analyst", "coach", "audio_description"] = DEFAULT_AUDIENCE
    existing_moves: List[ExistingPlayerMove] = Field(
        default_factory=list,
        description="Already-modified players on the board so the 2-move limit is preserved across commands.",
    )
    max_moves: int = Field(default=MAX_VOICE_MOVES, ge=1, le=MAX_VOICE_MOVES)


class WhatIfNLResponse(BaseModel):
    query: str
    interpreted_move: InterpretedWhatIfMove
    interpreted_moves: List[InterpretedWhatIfMove] = Field(default_factory=list)
    simulated_frame: MatchFramePayload
    tool_calls: List[Dict[str, Any]]
    verdict_summary: str


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, float(val)))


def _fold(text: str) -> str:
    """Lowercases and strips diacritics so spoken transcriptions match reliably."""
    norm = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")


_SPOKEN_NUMBERS: Dict[str, str] = {
    "uno": "1",
    "dos": "2",
    "tres": "3",
    "cuatro": "4",
    "cinco": "5",
    "seis": "6",
    "siete": "7",
    "ocho": "8",
    "nueve": "9",
    "diez": "10",
    "once": "11",
    "doce": "12",
    "trece": "13",
    "catorce": "14",
    "quince": "15",
    "dieciseis": "16",
    "diecisiete": "17",
    "dieciocho": "18",
    "diecinueve": "19",
    "veinte": "20",
    "veintiuno": "21",
    "veintidos": "22",
    "veintitres": "23",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
}


def _normalize_query_numbers(query: str) -> str:
    folded = _fold(query)
    for word, digit in _SPOKEN_NUMBERS.items():
        folded = re.sub(rf"\b{word}\b", digit, folded)
    return folded


def _parse_single_clause_move(
    clause: str,
    frame: MatchFramePayload,
    language: str = "es",
    exclude_ids: Optional[Set[int]] = None,
) -> InterpretedWhatIfMove:
    """Parses a single tactical clause into one legal player movement within the 6.0m inertia ring."""
    q = _normalize_query_numbers(clause.strip())
    lang = normalize_language(language)
    excluded = exclude_ids or set()

    defending_team = TeamSide.AWAY if frame.possession_team == TeamSide.HOME else TeamSide.HOME
    attacking_team = frame.possession_team

    # Determine whether query targets an attacker or a defender (defaults to defending team)
    is_attack_query = any(
        kw in q
        for kw in (
            "extremo",
            "delantero",
            "atacante",
            "punta",
            "desmarque",
            "espalda",
            "winger",
            "striker",
            "forward",
            "attacker",
        )
    )
    target_team = attacking_team if is_attack_query else defending_team
    outfield = [p for p in frame.players if p.team == target_team and not p.is_keeper and p.player_id not in excluded]
    if not outfield:
        outfield = [p for p in frame.players if not p.is_keeper and p.player_id not in excluded]
    if not outfield:
        outfield = [p for p in frame.players if not p.is_keeper]

    chosen: Optional[PlayerNode] = None
    role_label = "Defensor" if lang == "es" else "Defender"

    # 1. Check explicit jersey number (#5, dorsal 5, number 5, el 5, al 5, jugador 5)
    jersey_match = re.search(
        r"(?:#|dorsal\s+|number\s+|numero\s+|jugador\s+|player\s+|el\s+|al\s+|the\s+)(\d{1,2})\b(?!\s*(?:m\b|metros|metres|meters))",
        q,
    )
    if jersey_match:
        j_num = int(jersey_match.group(1))
        chosen = next(
            (p for p in frame.players if p.jersey_number == j_num and p.player_id not in excluded),
            None,
        ) or next((p for p in frame.players if p.jersey_number == j_num), None)
        if chosen:
            role_label = f"#{chosen.jersey_number}"

    # 2. Check explicit player name substring (accent-insensitive)
    if chosen is None:
        for p in frame.players:
            if p.player_id in excluded:
                continue
            parts = [_fold(part) for part in p.name.split() if len(part) >= 3]
            if any(part in q for part in parts):
                chosen = p
                role_label = p.name
                break

    # 3. Check tactical role keywords
    if chosen is None:
        if any(k in q for k in ("lateral", "carrilero", "full-back", "fullback", "wing-back", "wingback", "right-back", "left-back")):
            role_label = "Lateral" if lang == "es" else "Full-back"
            if any(k in q for k in ("derech", "right")):
                chosen = min(outfield, key=lambda p: p.y)
            elif any(k in q for k in ("izquierd", "left")):
                chosen = max(outfield, key=lambda p: p.y)
            else:
                wide_defs = sorted(outfield, key=lambda p: abs(p.y - 40.0), reverse=True)[:2]
                chosen = min(wide_defs, key=lambda p: abs(p.y - frame.ball_y))
        elif any(k in q for k in ("central", "zaguero", "centre-back", "center-back")):
            role_label = "Central" if lang == "es" else "Centre-back"
            central_defs = [p for p in outfield if 22.0 <= p.y <= 58.0] or outfield
            chosen = min(central_defs, key=lambda p: math.hypot(p.x - frame.ball_x, p.y - frame.ball_y))
        elif any(k in q for k in ("pivote", "mediocentro", "volante", "medio", "midfielder", "holding", "pivot")):
            role_label = "Mediocentro" if lang == "es" else "Holding Midfielder"
            mid_sorted = sorted(outfield, key=lambda p: p.x if p.team == TeamSide.AWAY else -p.x)
            chosen = mid_sorted[0]
        elif is_attack_query:
            role_label = "Atacante" if lang == "es" else "Attacker"
            non_actors = [p for p in outfield if not p.is_actor] or outfield
            if any(k in q for k in ("extremo", "banda", "winger")):
                chosen = max(non_actors, key=lambda p: abs(p.y - 40.0))
            else:
                chosen = max(non_actors, key=lambda p: p.x)
        else:
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

    if any(k in q for k in ("dentro", "interior", "centro", "medio", "intervalo", "inside", "inward", "half-space", "tuck", "middle", "center", "centre")):
        dy_dir = 1.0 if chosen.y < 40.0 else -1.0
        focal_x = frame.ball_end_x if frame.ball_end_x is not None else frame.ball_x
        dx_dir = 0.35 if focal_x > chosen.x else -0.35
        norm = math.hypot(dx_dir, dy_dir)
        ux, uy = dx_dir / norm, dy_dir / norm
        action_desc_es = "cierra por dentro hacia el carril interior"
        action_desc_en = "tucks inside into the half-space channel"
    elif any(k in q for k in ("banda", "fuera", "abre", "abrir", "exterior", "wide", "outside", "touchline", "flank")):
        dy_dir = -1.0 if chosen.y < 40.0 else 1.0
        ux, uy = 0.0, dy_dir
        action_desc_es = "bascula hacia la banda exterior"
        action_desc_en = "shifts wide towards the touchline"
    elif any(k in q for k in ("presion", "encima", "acosa", "achica", "salga", "salir", "balon", "poseedor", "press", "step up", "steps up", "jump", "carrier")):
        dx = frame.ball_x - chosen.x
        dy = frame.ball_y - chosen.y
        norm = max(0.1, math.hypot(dx, dy))
        ux, uy = dx / norm, dy / norm
        action_desc_es = "sale a presionar al poseedor del balón"
        action_desc_en = "steps out to press the ball carrier"
    elif any(k in q for k in ("adelant", "sube", "subir", "suba", "arriba", "delante", "desmarque", "espalda", "profundidad", "forward", "higher", "push up", "advance", "behind")):
        ux = -1.0 if chosen.team == TeamSide.AWAY else 1.0
        uy = 0.0
        action_desc_es = "adelanta su posición en el campo"
        action_desc_en = "steps higher up the pitch"
    elif any(k in q for k in ("recula", "retrocede", "hunde", "atras", "baja", "bajar", "baje", "drop", "deeper", "back", "retreat")):
        ux = 1.0 if chosen.team == TeamSide.AWAY else -1.0
        uy = 0.0
        action_desc_es = "recula hacia su propia área"
        action_desc_en = "drops deeper towards the penalty area"
    elif any(k in q for k in ("pase", "linea", "corte", "cortar", "tapa", "tapar", "receptor", "cubr", "marca", "lane", "cut", "block", "intercept", "cover", "mark", "receiver")):
        dest_x = frame.ball_end_x if frame.ball_end_x is not None else frame.ball_x
        dest_y = frame.ball_end_y if frame.ball_end_y is not None else 40.0
        mid_x = 0.65 * dest_x + 0.35 * frame.ball_x
        mid_y = 0.65 * dest_y + 0.35 * frame.ball_y
        dx, dy = mid_x - chosen.x, mid_y - chosen.y
        norm = max(0.1, math.hypot(dx, dy))
        ux, uy = dx / norm, dy / norm
        action_desc_es = "cierra la línea de pase principal"
        action_desc_en = "closes the primary passing lane"
    else:
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


def interpret_natural_language_moves(
    query: str,
    frame: MatchFramePayload,
    language: str = "es",
    max_moves: int = MAX_VOICE_MOVES,
    exclude_ids: Optional[Set[int]] = None,
) -> List[InterpretedWhatIfMove]:
    """
    Parses a natural-language tactical command into 1 or up to `max_moves` (2) legal player movements.
    Supports compound instructions ("que el lateral cierre por dentro y el central presione") as well
    as plural instructions ("que los dos centrales adelanten la línea").
    """
    cap = max(1, min(MAX_VOICE_MOVES, max_moves))
    used_ids: Set[int] = set(exclude_ids or set())
    q_norm = _normalize_query_numbers(query)

    # Split compound clauses when both parts look like tactical instructions
    clauses = [
        c.strip()
        for c in re.split(r"\s+(?:y\s+que|y\s+el|y\s+la|y\s+al|y\s+#|and\s+the|and\s+#|and\s+have|;\s*|\s+y\s+|\s+and\s+|\s+e\s+)", query, flags=re.IGNORECASE)
        if len(c.strip()) >= 3
    ]

    moves: List[InterpretedWhatIfMove] = []
    if len(clauses) >= 2 and cap >= 2:
        for clause in clauses[:cap]:
            move = _parse_single_clause_move(clause, frame, language, exclude_ids=used_ids)
            if move.player_id not in used_ids:
                used_ids.add(move.player_id)
                moves.append(move)
        if moves:
            return moves

    # Single clause: check if user asked for two players at once ("los dos", "ambos", "dos defensas", "both", "two")
    wants_two = cap >= 2 and any(
        kw in q_norm
        for kw in (
            "los 2",
            "las 2",
            "ambos",
            "2 defens",
            "2 central",
            "2 jugador",
            "los central",
            "los lateral",
            "both",
            "2 defender",
            "2 player",
            "centre-backs",
            "center-backs",
            "full-backs",
        )
    )

    first_move = _parse_single_clause_move(query, frame, language, exclude_ids=used_ids)
    used_ids.add(first_move.player_id)
    moves.append(first_move)

    if wants_two and len(moves) < cap:
        second_move = _parse_single_clause_move(query, frame, language, exclude_ids=used_ids)
        if second_move.player_id not in used_ids:
            used_ids.add(second_move.player_id)
            moves.append(second_move)

    return moves


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
    return interpret_natural_language_moves(query, frame, language, max_moves=1)[0]


async def execute_natural_language_what_if(
    request: WhatIfNLRequest,
    orchestrator: Optional[DialecticalAgentOrchestrator] = None,
) -> WhatIfNLResponse:
    """
    Executes a natural-language what-if scenario end-to-end using the engine tools
    (`xt_at`, `simulate_counterfactual`, `optimizer/solve`), enforces the 2-move limit,
    and generates the verified dialectical debate between Dr. Voronoi and Coach Bianchi.
    """
    lang = normalize_language(request.language)
    aud = normalize_audience(request.audience)
    base_frame = resolve_frame(match_id=request.match_id, event_uuid=request.event_uuid)

    # Apply any existing moves on the board so original_x/original_y are preserved
    existing_by_id: Dict[int, ExistingPlayerMove] = {
        m.player_id: m for m in request.existing_moves[:MAX_VOICE_MOVES]
    }
    remaining_slots = max(1, MAX_VOICE_MOVES - len(existing_by_id))

    moves = interpret_natural_language_moves(
        request.query,
        base_frame,
        lang,
        max_moves=min(request.max_moves, MAX_VOICE_MOVES),
    )

    # Merge existing board moves with newly interpreted voice moves, strictly capped at MAX_VOICE_MOVES (2)
    combined_mod_dicts: Dict[int, Dict[str, Any]] = {}
    for pid, em in existing_by_id.items():
        p_base = next((p for p in base_frame.players if p.player_id == pid), None)
        if p_base is not None:
            combined_mod_dicts[pid] = {
                "player_id": pid,
                "x": em.x,
                "y": em.y,
                "original_x": em.original_x if em.original_x is not None else p_base.x,
                "original_y": em.original_y if em.original_y is not None else p_base.y,
            }

    accepted_moves: List[InterpretedWhatIfMove] = []
    for mv in moves:
        if mv.player_id in combined_mod_dicts or len(combined_mod_dicts) < MAX_VOICE_MOVES:
            combined_mod_dicts[mv.player_id] = {
                "player_id": mv.player_id,
                "x": mv.to_x,
                "y": mv.to_y,
                "original_x": mv.from_x,
                "original_y": mv.from_y,
            }
            accepted_moves.append(mv)
        elif remaining_slots > 0 and len(accepted_moves) == 0:
            accepted_moves.append(mv)

    if not accepted_moves:
        accepted_moves = [moves[0]]
        # Replace the oldest move if 2 were already present so the user's latest spoken move takes effect
        if len(combined_mod_dicts) >= MAX_VOICE_MOVES:
            oldest_pid = next(iter(combined_mod_dicts))
            del combined_mod_dicts[oldest_pid]
        mv0 = moves[0]
        combined_mod_dicts[mv0.player_id] = {
            "player_id": mv0.player_id,
            "x": mv0.to_x,
            "y": mv0.to_y,
            "original_x": mv0.from_x,
            "original_y": mv0.from_y,
        }

    primary_move = accepted_moves[0]

    # 1. Execute engine tools via EngineToolRegistry
    registry = EngineToolRegistry(bound_frame=base_frame)
    await registry.xt_at(x=primary_move.to_x, y=primary_move.to_y, language=lang, caller_agent="what-if-nl")
    await registry.simulate_counterfactual(
        modified_players=[{"player_id": d["player_id"], "x": d["x"], "y": d["y"]} for d in combined_mod_dicts.values()],
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

    # 2. Build the simulated MatchFramePayload with up to 2 modified players
    mod_nodes: List[PlayerNode] = []
    for pid, d in combined_mod_dicts.items():
        target_player = next((p for p in base_frame.players if p.player_id == pid), None)
        if target_player is not None:
            mod_nodes.append(
                target_player.model_copy(
                    update={
                        "x": d["x"],
                        "y": d["y"],
                        "original_x": d["original_x"],
                        "original_y": d["original_y"],
                        "is_modified": True,
                    }
                )
            )
    simulated_frame = engine_simulate_counterfactual(base_frame, mod_nodes)

    # 3. Run the Dialectical Multi-Agent Orchestrator (with deterministic numerical verification)
    orch = orchestrator or DialecticalAgentOrchestrator()
    debate_report = await orch.run_debate(simulated_frame, language=lang, audience=aud)
    simulated_frame.agent_debate = debate_report.messages

    all_tools = [t.to_dict() for t in registry.trace]
    verdict_summary = (
        debate_report.verdict.summary
        if debate_report.verdict
        else " ".join(m.interpretation for m in accepted_moves)
    )

    return WhatIfNLResponse(
        query=request.query,
        interpreted_move=primary_move,
        interpreted_moves=accepted_moves,
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
