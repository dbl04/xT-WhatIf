"""
Unified Engine Tool Registry for xT-WhatIf Multi-Agent Swarm & MCP Server.

Exposes the core mathematical and spatial optimization engine as structured tools
compatible with:
1. Microsoft Agent Framework (`agent_framework` function tools)
2. Azure AI Foundry Agent Service / Azure OpenAI Function Calling (`tools` JSON Schema)
3. Model Context Protocol (`backend/app/mcp/server.py` `tools/list` and `tools/call`)

Core Engine Tools:
- `simulate_counterfactual`: Applies counterfactual player moves on a 360 freeze-frame,
  recomputing 16x12 bilinear xT, Gaussian pass probability cone, and 60x40 cKDTree Voronoi control.
- `optimizer/solve` (`optimizer_solve`): Runs the Auto-Coach inverse defensive optimizer
  within the 6.0m biomechanical inertia ring to find the threat-minimizing adjustment.
- `xt_at`: Evaluates exact continuous Expected Threat (xT) at pitch coordinates (x, y)
  on the canonical 120x80 pitch.
"""

from __future__ import annotations

import json
import math
import time
import logging
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

from app.schemas.match_contract import MatchFramePayload, PlayerNode, TeamSide
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.services.tactical_math import (
    get_xt_at_point,
    simulate_counterfactual as engine_simulate_counterfactual,
)
from app.services.tactical_optimizer import (
    OptimizeDefenseRequest,
    solve_optimal_defense,
)
from app.services.game_engine import frame_value
from app.services.narration import describe_spot, delta_context, normalize_language

logger = logging.getLogger("xtwhatif.agents.tools")


@dataclass
class ToolCallRecord:
    """Audit record for a single deterministic engine tool invocation."""
    tool_name: str
    arguments: Dict[str, Any]
    result: Dict[str, Any]
    caller_agent: str = "voronoi"
    duration_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CoachAdjustmentProposal:
    """Concrete tactical adjustment proposed by Coach Bianchi for Dr. Voronoi to validate."""
    player_id: int
    player_name: str
    jersey_number: int
    from_x: float
    from_y: float
    to_x: float
    to_y: float
    displacement_m: float
    target_threat_player_id: Optional[int]
    target_threat_player_name: str
    tactical_concept: str
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, float(val)))


def resolve_frame(
    match_id: int = DEFAULT_MATCH_ID,
    event_uuid: Optional[str] = None,
    bound_frame: Optional[MatchFramePayload] = None,
) -> MatchFramePayload:
    """Resolves a MatchFramePayload from an active session frame or from the match loader."""
    if bound_frame is not None:
        if not event_uuid or bound_frame.event_uuid == event_uuid:
            return bound_frame
    frames = loader.fetch_match_360_frames(match_id)
    if not frames:
        raise ValueError(f"No frames found for match_id={match_id}")
    if event_uuid:
        raw = next((f for f in frames if f["event_uuid"] == event_uuid), frames[0])
    else:
        raw = frames[0]
    return MatchFramePayload(**raw)


def propose_coach_adjustment(
    frame: MatchFramePayload,
    language: str = "es",
) -> CoachAdjustmentProposal:
    """
    Computes Coach Bianchi's classical tactical adjustment proposal on a frame.
    Identifies the open passing interval toward the optimal pass target (or primary receiver)
    and proposes a realistic cover shift (<= 5.5m within the 6.0m inertia ring) by the
    nearest unassigned defender/midfielder to screen the interior passing lane.
    """
    lang = normalize_language(language)
    ctx = delta_context(frame, lang)
    actor: PlayerNode = ctx["actor"]
    optimal: Optional[PlayerNode] = ctx["optimal"] or ctx["receiver"]

    defending_team = TeamSide.AWAY if frame.possession_team == TeamSide.HOME else TeamSide.HOME
    defenders = [p for p in frame.players if p.team == defending_team and not p.is_keeper]
    if not defenders:
        defenders = [p for p in frame.players if not p.is_actor]

    # Target point on the passing lane between ball carrier and optimal receiver
    if optimal is not None:
        lane_mid_x = 0.55 * optimal.x + 0.45 * frame.ball_x
        lane_mid_y = 0.65 * optimal.y + 0.35 * frame.ball_y
        target_name = optimal.name
        target_id = optimal.player_id
    else:
        lane_mid_x = min(115.0, frame.ball_x + 8.0)
        lane_mid_y = 40.0
        target_name = ctx["optimal_name"]
        target_id = ctx["optimal_id"]

    # Prefer a defender who wasn't already dragged, or the closest defender to the interior lane
    unmodified_defs = [d for d in defenders if not d.is_modified]
    candidate_pool = unmodified_defs if unmodified_defs else defenders
    chosen_def = min(
        candidate_pool,
        key=lambda d: math.hypot(d.x - lane_mid_x, d.y - lane_mid_y),
    )

    orig_x = chosen_def.original_x if chosen_def.original_x is not None else chosen_def.x
    orig_y = chosen_def.original_y if chosen_def.original_y is not None else chosen_def.y

    dx = lane_mid_x - chosen_def.x
    dy = lane_mid_y - chosen_def.y
    raw_dist = math.hypot(dx, dy)
    # Coach Bianchi proposes a 3.5m - 5.2m tactical cover shift within the 6m inertia envelope
    shift_m = min(5.2, max(2.8, raw_dist * 0.65)) if raw_dist > 0.2 else 3.5

    if raw_dist > 0.2:
        ux, uy = dx / raw_dist, dy / raw_dist
    else:
        # Default: tuck inside towards central axis (y=40) and step slightly toward goal
        ux = 0.6
        uy = 0.8 if chosen_def.y < 40.0 else -0.8

    to_x = _clamp(round(chosen_def.x + ux * shift_m, 1), 1.0, 119.0)
    to_y = _clamp(round(chosen_def.y + uy * shift_m, 1), 1.0, 79.0)

    # Ensure total displacement from original position stays strictly within 6.0m inertia ring
    total_disp = math.hypot(to_x - orig_x, to_y - orig_y)
    if total_disp > 5.8:
        scale = 5.8 / total_disp
        to_x = _clamp(round(orig_x + (to_x - orig_x) * scale, 1), 1.0, 119.0)
        to_y = _clamp(round(orig_y + (to_y - orig_y) * scale, 1), 1.0, 79.0)
        total_disp = math.hypot(to_x - orig_x, to_y - orig_y)

    if lang == "es":
        concept = "Basculación interior al intervalo central-lateral"
        rationale = (
            f"Cerrar con {chosen_def.name} (#{chosen_def.jersey_number}) {total_disp:.1f} m hacia ({to_x:.1f}, {to_y:.1f}) "
            f"para cortar la línea de pase interior hacia {target_name}."
        )
    else:
        concept = "Inside cover shift into the centre-back/full-back interval"
        rationale = (
            f"Slide {chosen_def.name} (#{chosen_def.jersey_number}) {total_disp:.1f} m to ({to_x:.1f}, {to_y:.1f}) "
            f"to screen the inside passing lane towards {target_name}."
        )

    return CoachAdjustmentProposal(
        player_id=chosen_def.player_id,
        player_name=chosen_def.name,
        jersey_number=chosen_def.jersey_number,
        from_x=round(orig_x, 1),
        from_y=round(orig_y, 1),
        to_x=round(to_x, 1),
        to_y=round(to_y, 1),
        displacement_m=round(total_disp, 1),
        target_threat_player_id=target_id,
        target_threat_player_name=target_name,
        tactical_concept=concept,
        rationale=rationale,
    )


class EngineToolRegistry:
    """
    Stateful or stateless tool registry exposing the xT-WhatIf tactical math and optimizer engine.
    Used identically by:
    - Multi-Agent Swarm (Dr. Voronoi & Coach Bianchi)
    - MCP Server (`app/mcp/server.py`)
    - Natural-Language What-If service (`app/agents/what_if_nl.py`)
    """

    def __init__(self, bound_frame: Optional[MatchFramePayload] = None):
        self.bound_frame: Optional[MatchFramePayload] = bound_frame
        self.trace: List[ToolCallRecord] = []

    def bind_frame(self, frame: MatchFramePayload) -> None:
        self.bound_frame = frame

    def clear_trace(self) -> None:
        self.trace.clear()

    # -------------------------------------------------------------------------
    # Tool 1: xt_at
    # -------------------------------------------------------------------------
    async def xt_at(
        self,
        x: float,
        y: float,
        language: str = "es",
        caller_agent: str = "voronoi",
    ) -> Dict[str, Any]:
        """
        Evaluates continuous Expected Threat (xT) at pitch coordinates (x, y)
        via 2D bilinear interpolation over the canonical 16x12 matrix on a 120x80m pitch.
        """
        t0 = time.perf_counter()
        x_c = _clamp(x, 0.0, 120.0)
        y_c = _clamp(y, 0.0, 80.0)
        xt_val = get_xt_at_point(x_c, y_c)
        lang = normalize_language(language)
        col = min(15, max(0, int(x_c / (120.0 / 16.0))))
        row = min(11, max(0, int(y_c / (80.0 / 12.0))))
        result = {
            "x": round(x_c, 1),
            "y": round(y_c, 1),
            "xt": round(xt_val, 4),
            "xt_rounded": round(xt_val, 2),
            "goal_probability_pct": int(round(xt_val * 100)),
            "grid_cell": {"col": col, "row": row, "grid": "16x12"},
            "zone_description": describe_spot(x_c, y_c, lang),
        }
        dur = round((time.perf_counter() - t0) * 1000, 2)
        self.trace.append(
            ToolCallRecord(
                tool_name="xt_at",
                arguments={"x": round(x_c, 1), "y": round(y_c, 1), "language": lang},
                result=result,
                caller_agent=caller_agent,
                duration_ms=dur,
            )
        )
        return result

    # -------------------------------------------------------------------------
    # Tool 2: simulate_counterfactual
    # -------------------------------------------------------------------------
    async def simulate_counterfactual(
        self,
        modified_players: Optional[List[Dict[str, Any]]] = None,
        match_id: int = DEFAULT_MATCH_ID,
        event_uuid: Optional[str] = None,
        include_bound_modifications: bool = True,
        caller_agent: str = "voronoi",
    ) -> Dict[str, Any]:
        """
        Executes a counterfactual simulation on a freeze-frame by applying modified player
        positions and recomputing xT (16x12 bilinear), pass completion probability (Gaussian cone),
        Voronoi territorial control (60x40 cKDTree), and optimal pass target.
        """
        t0 = time.perf_counter()
        base_frame = resolve_frame(match_id=match_id, event_uuid=event_uuid, bound_frame=self.bound_frame)
        by_id = {p.player_id: p for p in base_frame.players}

        # Start with already-modified players on the bound frame if requested
        mod_map: Dict[int, PlayerNode] = {}
        if include_bound_modifications:
            for p in base_frame.players:
                if p.is_modified:
                    mod_map[p.player_id] = p.model_copy()

        for item in modified_players or []:
            pid = int(item["player_id"])
            if pid not in by_id:
                continue
            orig_p = by_id[pid]
            nx = _clamp(float(item.get("x", orig_p.x)), 0.0, 120.0)
            ny = _clamp(float(item.get("y", orig_p.y)), 0.0, 80.0)
            mod_map[pid] = orig_p.model_copy(
                update={
                    "x": round(nx, 1),
                    "y": round(ny, 1),
                    "original_x": orig_p.original_x if orig_p.original_x is not None else orig_p.x,
                    "original_y": orig_p.original_y if orig_p.original_y is not None else orig_p.y,
                    "is_modified": True,
                }
            )

        mod_nodes = list(mod_map.values())
        sim_frame = engine_simulate_counterfactual(base_frame, mod_nodes)
        m = sim_frame.metrics
        ctx = delta_context(sim_frame, "es")
        ev = frame_value(sim_frame)

        moved_details = []
        for p in sim_frame.players:
            if p.is_modified and p.original_x is not None and p.original_y is not None:
                disp = math.hypot(p.x - p.original_x, p.y - p.original_y)
                moved_details.append({
                    "player_id": p.player_id,
                    "name": p.name,
                    "jersey_number": p.jersey_number,
                    "from_x": round(p.original_x, 1),
                    "from_y": round(p.original_y, 1),
                    "to_x": round(p.x, 1),
                    "to_y": round(p.y, 1),
                    "displacement_m": round(disp, 1),
                    "within_inertia_radius": disp <= 6.05,
                })

        rel_pct = abs(int((m.xt_delta / max(0.01, m.original_xt)) * 100))
        result = {
            "event_uuid": sim_frame.event_uuid,
            "original_xt": round(m.original_xt, 2),
            "simulated_xt": round(m.simulated_xt, 2),
            "xt_delta": round(m.xt_delta, 2),
            "relative_xt_change_pct": rel_pct,
            "pass_completion_prob": round(m.pass_completion_prob, 1),
            "space_control_home_pct": round(m.space_control_home_pct, 1),
            "optimal_pass_target_id": m.optimal_pass_target_id,
            "optimal_pass_target_name": ctx["optimal_name"],
            "receiver_id": ctx["receiver_id"],
            "receiver_name": ctx["receiver_name"],
            "action_value_ev": round(ev.value, 3),
            "moved_players": moved_details,
        }
        dur = round((time.perf_counter() - t0) * 1000, 2)
        self.trace.append(
            ToolCallRecord(
                tool_name="simulate_counterfactual",
                arguments={
                    "event_uuid": sim_frame.event_uuid,
                    "modified_players": [
                        {"player_id": p.player_id, "x": round(p.x, 1), "y": round(p.y, 1)}
                        for p in mod_nodes
                    ],
                },
                result=result,
                caller_agent=caller_agent,
                duration_ms=dur,
            )
        )
        return result

    # -------------------------------------------------------------------------
    # Tool 3: optimizer/solve (optimizer_solve)
    # -------------------------------------------------------------------------
    async def optimizer_solve(
        self,
        max_defenders_to_move: int = 2,
        max_radius_meters: float = 5.8,
        match_id: int = DEFAULT_MATCH_ID,
        event_uuid: Optional[str] = None,
        caller_agent: str = "voronoi",
    ) -> Dict[str, Any]:
        """
        Invokes the Auto-Coach spatial inverse defensive optimizer (`optimizer/solve`)
        to find the defensive micro-adjustments within the 6.0m inertia ring that minimize
        composite threat J = 0.65 * simulated_xt + 0.35 * max_alt(EV_receiver).
        """
        t0 = time.perf_counter()
        target_frame = resolve_frame(match_id=match_id, event_uuid=event_uuid, bound_frame=self.bound_frame)
        req = OptimizeDefenseRequest(
            frame=target_frame,
            max_defenders_to_move=max(1, min(3, int(max_defenders_to_move))),
            max_radius_meters=min(6.0, max(1.0, float(max_radius_meters))),
        )
        opt_res = await solve_optimal_defense(req)
        pm = opt_res.projected_metrics
        result = {
            "event_uuid": target_frame.event_uuid,
            "projected_metrics": {
                "original_xt": round(pm.original_xt, 2),
                "simulated_xt": round(pm.simulated_xt, 2),
                "xt_delta": round(pm.xt_delta, 2),
                "pass_completion_prob": round(pm.pass_completion_prob, 1),
                "space_control_home_pct": round(pm.space_control_home_pct, 1),
                "optimal_pass_target_id": pm.optimal_pass_target_id,
            },
            "adjustments": [adj.model_dump() for adj in opt_res.adjustments],
            "evaluated_configurations": opt_res.evaluated_configurations,
            "compute_time_ms": opt_res.compute_time_ms,
        }
        dur = round((time.perf_counter() - t0) * 1000, 2)
        self.trace.append(
            ToolCallRecord(
                tool_name="optimizer/solve",
                arguments={
                    "event_uuid": target_frame.event_uuid,
                    "max_defenders_to_move": req.max_defenders_to_move,
                    "max_radius_meters": req.max_radius_meters,
                },
                result=result,
                caller_agent=caller_agent,
                duration_ms=dur,
            )
        )
        return result

    # -------------------------------------------------------------------------
    # Generic Dispatcher (used by OpenAI tool calling, Microsoft Agent Framework & MCP)
    # -------------------------------------------------------------------------
    async def execute_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
        caller_agent: str = "voronoi",
    ) -> Dict[str, Any]:
        """Dispatches a tool call by name (`simulate_counterfactual`, `optimizer/solve`, `optimizer_solve`, `xt_at`)."""
        args = dict(arguments or {})
        normalized = name.strip().lower()

        if normalized in ("xt_at", "get_xt_at_point", "get_xt_at_position"):
            return await self.xt_at(
                x=float(args.get("x", 60.0)),
                y=float(args.get("y", 40.0)),
                language=str(args.get("language", "es")),
                caller_agent=caller_agent,
            )

        if normalized in ("simulate_counterfactual", "simulate/counterfactual"):
            return await self.simulate_counterfactual(
                modified_players=args.get("modified_players") or args.get("moves") or [],
                match_id=int(args.get("match_id", DEFAULT_MATCH_ID)),
                event_uuid=args.get("event_uuid"),
                include_bound_modifications=bool(args.get("include_bound_modifications", True)),
                caller_agent=caller_agent,
            )

        if normalized in ("optimizer/solve", "optimizer_solve", "solve_optimal_defense"):
            return await self.optimizer_solve(
                max_defenders_to_move=int(args.get("max_defenders_to_move", 2)),
                max_radius_meters=float(args.get("max_radius_meters", 5.8)),
                match_id=int(args.get("match_id", DEFAULT_MATCH_ID)),
                event_uuid=args.get("event_uuid"),
                caller_agent=caller_agent,
            )

        raise ValueError(f"Unknown engine tool: {name}")

    # -------------------------------------------------------------------------
    # Schemas for OpenAI / Foundry Function Calling & MCP `tools/list`
    # -------------------------------------------------------------------------
    @staticmethod
    def get_openai_tools() -> List[Dict[str, Any]]:
        """Returns tool definitions in OpenAI / Azure AI Foundry function-calling format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "simulate_counterfactual",
                    "description": (
                        "Executes a counterfactual football simulation on the active 360 freeze-frame. "
                        "Moves one or more players to new (x, y) pitch coordinates (120x80m) and recalculates "
                        "Expected Threat (xT), Gaussian pass completion probability, Voronoi space control %, "
                        "and the optimal pass receiver."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "modified_players": {
                                "type": "array",
                                "description": "List of player coordinate adjustments to simulate.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "player_id": {"type": "integer", "description": "Player ID in the frame."},
                                        "x": {"type": "number", "description": "Pitch X coordinate in [0.0, 120.0]."},
                                        "y": {"type": "number", "description": "Pitch Y coordinate in [0.0, 80.0]."},
                                    },
                                    "required": ["player_id", "x", "y"],
                                },
                            },
                            "event_uuid": {
                                "type": "string",
                                "description": "Optional event UUID (defaults to the active frame).",
                            },
                        },
                        "required": ["modified_players"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "optimizer_solve",
                    "description": (
                        "Invokes the Auto-Coach spatial inverse defensive optimizer (optimizer/solve). "
                        "Searches polar candidate displacements within the 6.0m biomechanical inertia ring "
                        "to find the defensive adjustment that minimizes composite Expected Threat (xT)."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "max_defenders_to_move": {
                                "type": "integer",
                                "description": "Maximum number of defenders to adjust (1 to 3).",
                                "default": 2,
                            },
                            "max_radius_meters": {
                                "type": "number",
                                "description": "Maximum displacement radius in meters (<= 6.0m inertia ring).",
                                "default": 5.8,
                            },
                            "event_uuid": {
                                "type": "string",
                                "description": "Optional event UUID (defaults to the active frame).",
                            },
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "xt_at",
                    "description": (
                        "Computes the continuous Expected Threat (xT) at pitch coordinates (x, y) "
                        "on the canonical 120x80m pitch via 2D bilinear interpolation on the 16x12 xT grid."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "x": {"type": "number", "description": "Pitch X coordinate in [0.0, 120.0]."},
                            "y": {"type": "number", "description": "Pitch Y coordinate in [0.0, 80.0]."},
                            "language": {
                                "type": "string",
                                "enum": ["en", "es"],
                                "default": "es",
                            },
                        },
                        "required": ["x", "y"],
                    },
                },
            },
        ]

    @classmethod
    def get_mcp_tools(cls) -> List[Dict[str, Any]]:
        """
        Returns tool definitions in Model Context Protocol (MCP) `tools/list` format.
        Exposes `simulate_counterfactual`, `optimizer/solve` (and `optimizer_solve`), and `xt_at`.
        """
        openai_tools = cls.get_openai_tools()
        mcp_list: List[Dict[str, Any]] = []
        for t in openai_tools:
            fn = t["function"]
            name = "optimizer/solve" if fn["name"] == "optimizer_solve" else fn["name"]
            mcp_list.append({
                "name": name,
                "description": fn["description"],
                "inputSchema": fn["parameters"],
            })
        return mcp_list
