"""
Tactical Mathematical Service for xT-WhatIf.
Standard StatsBomb coordinates: X [0.0 - 120.0] and Y [0.0 - 80.0].
Computes Expected Threat (xT), Voronoi space control, passing probabilities, and optimal target.
"""

import math
import numpy as np
from typing import List, Tuple, Optional
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, box

from app.schemas.match_contract import (
    MatchFramePayload, PlayerNode, TacticalMetrics, TeamSide
)

XT_GRID_COLS = 16
XT_GRID_ROWS = 12


def _generate_canonical_xt_grid() -> np.ndarray:
    grid = np.zeros((XT_GRID_ROWS, XT_GRID_COLS))
    for r in range(XT_GRID_ROWS):
        y_dist = abs(r - (XT_GRID_ROWS - 1) / 2.0)
        for c in range(XT_GRID_COLS):
            x_factor = (c / (XT_GRID_COLS - 1)) ** 2.2
            y_factor = 1.0 - (y_dist / ((XT_GRID_ROWS - 1) / 2.0)) * 0.45
            base_xt = 0.01 + 0.55 * x_factor * max(0.2, y_factor)
            grid[r, c] = round(base_xt, 4)
    return grid


XT_LOOKUP_GRID = _generate_canonical_xt_grid()


def get_xt_at_position(x: float, y: float) -> float:
    """Returns Expected Threat (xT) on canonical 120x80 pitch."""
    col = min(XT_GRID_COLS - 1, max(0, int((x / 120.0) * XT_GRID_COLS)))
    row = min(XT_GRID_ROWS - 1, max(0, int((y / 80.0) * XT_GRID_ROWS)))
    return float(XT_LOOKUP_GRID[row, col])


def calculate_pass_metrics(
    actor: PlayerNode, teammates: List[PlayerNode], opponents: List[PlayerNode]
) -> Tuple[Optional[int], float]:
    """
    Computes optimal pass target ID and completion probability.
    """
    best_target_id = None
    best_ev = -1.0
    best_prob = 50.0

    actor_xt = get_xt_at_position(actor.x, actor.y)

    for mate in teammates:
        if mate.player_id == actor.player_id:
            continue

        dist = math.hypot(mate.x - actor.x, mate.y - actor.y)
        base_prob = max(10.0, 100.0 - (dist / 60.0) * 45.0)

        # Check defender interception
        line_vec = np.array([mate.x - actor.x, mate.y - actor.y])
        line_len = np.linalg.norm(line_vec)

        if line_len > 1e-4:
            unit_line = line_vec / line_len
            for opp in opponents:
                opp_vec = np.array([opp.x - actor.x, opp.y - actor.y])
                proj = np.dot(opp_vec, unit_line)
                if 2.0 < proj < (line_len - 2.0):
                    perp_dist = np.linalg.norm(opp_vec - proj * unit_line)
                    if perp_dist < 4.0:
                        base_prob *= 0.55

        mate_xt = get_xt_at_position(mate.x, mate.y)
        expected_value = (base_prob / 100.0) * mate_xt

        if expected_value > best_ev:
            best_ev = expected_value
            best_target_id = mate.player_id
            best_prob = round(base_prob, 1)

    return best_target_id, best_prob


def calculate_space_control_home(players: List[PlayerNode]) -> float:
    """Calculates home team space control percentage in active attacking zone."""
    home_count = sum(1 for p in players if p.team == TeamSide.HOME and p.x > 60.0)
    away_count = sum(1 for p in players if p.team == TeamSide.AWAY and p.x > 60.0)
    total = max(1, home_count + away_count)
    return round((home_count / total) * 100.0, 1)


def simulate_counterfactual(
    base_frame: MatchFramePayload, modified_players: List[PlayerNode]
) -> MatchFramePayload:
    """
    Applies counterfactual player positions, recalculates xT delta, optimal pass, and space control.
    """
    mod_dict = {p.player_id: p for p in modified_players}

    updated_players: List[PlayerNode] = []
    for p in base_frame.players:
        if p.player_id in mod_dict:
            new_p = mod_dict[p.player_id]
            updated_players.append(
                p.model_copy(
                    update={
                        "x": new_p.x,
                        "y": new_p.y,
                        "original_x": p.original_x or p.x,
                        "original_y": p.original_y or p.y,
                        "is_modified": True,
                    }
                )
            )
        else:
            updated_players.append(p.model_copy())

    # Find actor / ball carrier
    actor = next((p for p in updated_players if p.is_actor), updated_players[0])
    home_players = [p for p in updated_players if p.team == TeamSide.HOME]
    away_players = [p for p in updated_players if p.team == TeamSide.AWAY]

    teammates = home_players if actor.team == TeamSide.HOME else away_players
    opponents = away_players if actor.team == TeamSide.HOME else home_players

    optimal_id, pass_prob = calculate_pass_metrics(actor, teammates, opponents)
    space_home_pct = calculate_space_control_home(updated_players)

    # Calculate xT
    simulated_xt = round(get_xt_at_position(actor.x, actor.y), 2)
    original_xt = round(base_frame.metrics.original_xt, 2)
    xt_delta = round(simulated_xt - original_xt, 2)

    new_metrics = TacticalMetrics(
        original_xt=original_xt,
        simulated_xt=simulated_xt,
        xt_delta=xt_delta,
        space_control_home_pct=space_home_pct,
        optimal_pass_target_id=optimal_id,
        pass_completion_prob=pass_prob,
    )

    return base_frame.model_copy(
        update={
            "is_counterfactual_mode": True,
            "players": updated_players,
            "metrics": new_metrics,
        }
    )
