"""
Auto-Coach AI: Spatial Inverse Defensive Optimizer for xT-WhatIf.
Solves for the optimal defensive micro-adjustments within the legal 6.0m physical inertia ring.
Minimizes composite threat: J = 0.65 * simulated_xt + 0.35 * max_alt(EV_receiver).
"""

import time
import math
import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter

from app.schemas.match_contract import (
    MatchFramePayload, PlayerNode, TacticalMetrics, TeamSide
)
from app.services.tactical_math import simulate_counterfactual

logger = logging.getLogger("xtwhatif.optimizer")

router = APIRouter(prefix="/api/v1/optimizer", tags=["optimizer"])


class OptimizeDefenseRequest(BaseModel):
    frame: MatchFramePayload
    max_defenders_to_move: int = Field(default=2, ge=1, le=3)
    max_radius_meters: float = Field(default=5.8, le=6.0, description="Respeta el anillo de inercia de 6.0m")


class DefenderAdjustment(BaseModel):
    player_id: int
    name: str
    from_x: float
    from_y: float
    to_x: float
    to_y: float
    displacement_m: float
    tactical_reason: str


class OptimizeDefenseResponse(BaseModel):
    optimized_players: List[PlayerNode]
    projected_metrics: TacticalMetrics
    adjustments: List[DefenderAdjustment]
    evaluated_configurations: int
    compute_time_ms: float


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


@router.post("/solve", response_model=OptimizeDefenseResponse)
async def solve_optimal_defense(request: OptimizeDefenseRequest) -> OptimizeDefenseResponse:
    """
    Evaluates polar candidate displacements for primary defenders to find the optimal
    micro-shift that minimizes expected threat and passing lane apertures.
    """
    t0 = time.perf_counter()
    frame = request.frame
    max_defenders = request.max_defenders_to_move
    max_radius = min(5.8, request.max_radius_meters)

    # 1. Identify defending team (team not in possession)
    defending_team = TeamSide.AWAY if frame.possession_team == TeamSide.HOME else TeamSide.HOME

    # Non-keeper defenders
    defenders = [
        p for p in frame.players
        if p.team == defending_team and not p.is_keeper
    ]

    if not defenders:
        return OptimizeDefenseResponse(
            optimized_players=frame.players,
            projected_metrics=frame.metrics,
            adjustments=[],
            evaluated_configurations=0,
            compute_time_ms=round((time.perf_counter() - t0) * 1000, 2)
        )

    # 2. Determine target focal point (threat locus: ball destination or ball origin)
    focal_x = frame.ball_end_x if frame.ball_end_x is not None else frame.ball_x
    focal_y = frame.ball_end_y if frame.ball_end_y is not None else frame.ball_y

    # Sort defenders by proximity to the focal threat
    defenders_by_dist = sorted(
        defenders,
        key=lambda d: math.hypot(d.x - focal_x, d.y - focal_y)
    )
    key_defenders = defenders_by_dist[:max_defenders]

    # 3. Generate polar displacement candidate vectors (radii: 2.0m, 4.0m, max_radius)
    radii = [2.0, 4.0, max_radius]
    angles = [i * (2.0 * math.pi / 8.0) for i in range(8)]  # 8 cardinal/intercardinal rays

    # Evaluate baseline cost
    base_metrics = frame.metrics
    alt_ev_base = (base_metrics.pass_completion_prob / 100.0) * base_metrics.simulated_xt
    best_cost = 0.65 * base_metrics.simulated_xt + 0.35 * alt_ev_base
    best_frame = frame
    best_modifications = {p.player_id: (p.x, p.y) for p in frame.players}
    evaluated_count = 0

    # Iterative coordinate descent / greedy evaluation across key defenders
    current_modified_players = [p.model_copy() for p in frame.players]

    for defender in key_defenders:
        best_defender_pos = (defender.x, defender.y)
        best_defender_cost = best_cost
        orig_x, orig_y = defender.x, defender.y

        # Candidate pool for this defender
        candidate_coords = [(orig_x, orig_y)]
        for r in radii:
            for angle in angles:
                cand_x = _clamp(round(orig_x + r * math.cos(angle), 1), 0.0, 120.0)
                cand_y = _clamp(round(orig_y + r * math.sin(angle), 1), 0.0, 80.0)
                candidate_coords.append((cand_x, cand_y))

        for cx, cy in candidate_coords:
            evaluated_count += 1
            # Temporarily replace defender position
            test_players = []
            for p in current_modified_players:
                if p.player_id == defender.player_id:
                    test_players.append(
                        p.model_copy(update={
                            "x": cx,
                            "y": cy,
                            "original_x": orig_x if p.original_x is None else p.original_x,
                            "original_y": orig_y if p.original_y is None else p.original_y,
                            "is_modified": True if (cx != orig_x or cy != orig_y) else p.is_modified
                        })
                    )
                else:
                    test_players.append(p)

            # Evaluate simulation
            sim = simulate_counterfactual(frame, test_players)
            alt_ev = (sim.metrics.pass_completion_prob / 100.0) * sim.metrics.simulated_xt
            cost = 0.65 * sim.metrics.simulated_xt + 0.35 * alt_ev

            if cost < best_defender_cost:
                best_defender_cost = cost
                best_defender_pos = (cx, cy)
                best_frame = sim

        # Lock in best position for this defender if improved
        if best_defender_cost < best_cost:
            best_cost = best_defender_cost
            current_modified_players = [
                p.model_copy(update={
                    "x": best_defender_pos[0],
                    "y": best_defender_pos[1],
                    "original_x": orig_x if p.original_x is None else p.original_x,
                    "original_y": orig_y if p.original_y is None else p.original_y,
                    "is_modified": True if (best_defender_pos != (orig_x, orig_y)) else p.is_modified
                }) if p.player_id == defender.player_id else p
                for p in current_modified_players
            ]

    # 4. Compile adjustments summary
    adjustments: List[DefenderAdjustment] = []
    final_players: List[PlayerNode] = []

    for p in current_modified_players:
        orig = next((op for op in frame.players if op.player_id == p.player_id), p)
        disp = math.hypot(p.x - orig.x, p.y - orig.y)
        if disp > 0.05:
            p_final = p.model_copy(update={
                "original_x": orig.x,
                "original_y": orig.y,
                "is_modified": True
            })
            adjustments.append(
                DefenderAdjustment(
                    player_id=p.player_id,
                    name=p.name,
                    from_x=round(orig.x, 1),
                    from_y=round(orig.y, 1),
                    to_x=round(p.x, 1),
                    to_y=round(p.y, 1),
                    displacement_m=round(disp, 2),
                    tactical_reason=f"Basculación de cobertura ({disp:.1f}m) interceptando cono hacia zona final."
                )
            )
            final_players.append(p_final)
        else:
            final_players.append(p)

    final_sim = simulate_counterfactual(frame, final_players)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return OptimizeDefenseResponse(
        optimized_players=final_players,
        projected_metrics=final_sim.metrics,
        adjustments=adjustments,
        evaluated_configurations=evaluated_count,
        compute_time_ms=elapsed_ms
    )
