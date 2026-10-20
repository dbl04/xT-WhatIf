"""
Advanced Tactical Mathematical Engine for xT-WhatIf.
Standard StatsBomb coordinates: X [0.0 - 120.0] and Y [0.0 - 80.0].

Features:
1. Vectorized Voronoi & Space Ownership on a fine 60x40 spatial grid over the active offensive third.
2. Gaussian interception cone for passing lanes with expanding width along the pass trajectory.
3. Realistic Expected Threat (xT) calculation with recovery penalty for intercepted passes.
4. Optimal pass target selector evaluating expected values (EV) across all active teammates.
"""

import math
import numpy as np
from scipy.spatial import cKDTree as KDTree
from typing import List, Tuple, Optional

from app.schemas.match_contract import (
    MatchFramePayload, PlayerNode, TacticalMetrics, TeamSide
)

# -----------------------------------------------------------------------------
# 16x12 Expected Threat (xT) Transition Grid on 120x80 Pitch
# -----------------------------------------------------------------------------
XT_GRID_COLS = 16
XT_GRID_ROWS = 12


def _generate_canonical_xt_grid() -> np.ndarray:
    grid = np.zeros((XT_GRID_ROWS, XT_GRID_COLS))
    for r in range(XT_GRID_ROWS):
        y_dist = abs(r - (XT_GRID_ROWS - 1) / 2.0)
        for c in range(XT_GRID_COLS):
            x_factor = (c / (XT_GRID_COLS - 1)) ** 2.2
            y_factor = 1.0 - (y_dist / ((XT_GRID_ROWS - 1) / 2.0)) * 0.45
            base_xt = 0.01 + 0.65 * x_factor * max(0.18, y_factor)
            grid[r, c] = round(base_xt, 4)
    return grid


XT_LOOKUP_GRID = _generate_canonical_xt_grid()
XT_MATRIX = XT_LOOKUP_GRID


def get_xt_at_point(x: float, y: float) -> float:
    """
    Computes Expected Threat (xT) on canonical 120x80 pitch using continuous
    2D bilinear interpolation across adjacent cell centers in the 16x12 xT matrix.
    Ensures that any micro-displacement (e.g. 0.5m) generates a smooth, continuous delta.
    """
    # Clamp coordinates to pitch boundaries [0.0, 120.0] x [0.0, 80.0]
    x_clamped = max(0.0, min(120.0, float(x)))
    y_clamped = max(0.0, min(80.0, float(y)))

    cell_w = 120.0 / XT_GRID_COLS  # 7.5 meters per column
    cell_h = 80.0 / XT_GRID_ROWS   # 6.6667 meters per row

    # Continuous cell-center relative coordinates
    # Center of cell (r, c) is located at ((c + 0.5) * cell_w, (r + 0.5) * cell_h)
    u = (x_clamped / cell_w) - 0.5
    v = (y_clamped / cell_h) - 0.5

    c0 = int(math.floor(u))
    r0 = int(math.floor(v))

    c1 = c0 + 1
    r1 = r0 + 1

    # Fractional interpolation weights in [0.0, 1.0]
    alpha_x = u - c0
    alpha_y = v - r0

    # Boundary handling for pitch margins outside inner cell centers
    if c0 < 0:
        c0_idx = 0
        c1_idx = 0
        alpha_x = 0.0
    elif c0 >= XT_GRID_COLS - 1:
        c0_idx = XT_GRID_COLS - 1
        c1_idx = XT_GRID_COLS - 1
        alpha_x = 0.0
    else:
        c0_idx = c0
        c1_idx = c1

    if r0 < 0:
        r0_idx = 0
        r1_idx = 0
        alpha_y = 0.0
    elif r0 >= XT_GRID_ROWS - 1:
        r0_idx = XT_GRID_ROWS - 1
        r1_idx = XT_GRID_ROWS - 1
        alpha_y = 0.0
    else:
        r0_idx = r0
        r1_idx = r1

    alpha_x = max(0.0, min(1.0, alpha_x))
    alpha_y = max(0.0, min(1.0, alpha_y))

    # 4 adjacent cell values from canonical XT_MATRIX
    q00 = float(XT_MATRIX[r0_idx, c0_idx])
    q10 = float(XT_MATRIX[r0_idx, c1_idx])
    q01 = float(XT_MATRIX[r1_idx, c0_idx])
    q11 = float(XT_MATRIX[r1_idx, c1_idx])

    # Real 2D bilinear interpolation formula
    interpolated_xt = (
        (1.0 - alpha_x) * (1.0 - alpha_y) * q00
        + alpha_x * (1.0 - alpha_y) * q10
        + (1.0 - alpha_x) * alpha_y * q01
        + alpha_x * alpha_y * q11
    )
    return round(float(interpolated_xt), 4)


# Backward-compatible alias for existing callers
get_xt_at_position = get_xt_at_point


# -----------------------------------------------------------------------------
# Vectorized Voronoi Space Control via scipy.spatial.cKDTree (60x40 Grid)
# -----------------------------------------------------------------------------
GRID_X_POINTS = 60
GRID_Y_POINTS = 40
GRID_X_MIN = 60.0
GRID_X_MAX = 120.0
GRID_Y_MIN = 0.0
GRID_Y_MAX = 80.0

# Pre-computed coordinate grid mesh of the offensive final third (2,400 sample points)
_GRID_X, _GRID_Y = np.meshgrid(
    np.linspace(GRID_X_MIN, GRID_X_MAX, GRID_X_POINTS),
    np.linspace(GRID_Y_MIN, GRID_Y_MAX, GRID_Y_POINTS)
)
_GRID_POINTS = np.column_stack([_GRID_X.ravel(), _GRID_Y.ravel()])


def calculate_space_control(
    players: List[PlayerNode],
    ball_x: Optional[float] = None,
    ball_y: Optional[float] = None,
    grid_points: Optional[np.ndarray] = None
) -> float:
    """
    Computes home team territory ownership percentage in the active attacking third
    ([60.0, 120.0] x [0.0, 80.0]) using scipy.spatial.cKDTree over a fine 60x40 mesh (2,400 points).
    Queries tree in sub-milliseconds and weights control by ball proximity and player movement inertia.
    """
    if not players:
        return 50.0

    if grid_points is None:
        grid_points = _GRID_POINTS

    # Extract coordinates and team affiliations
    player_coords = np.array([[p.x, p.y] for p in players], dtype=np.float64)
    is_home = np.array([p.team == TeamSide.HOME for p in players], dtype=bool)

    # Sub-millisecond nearest neighbor query via Scipy cKDTree
    tree = KDTree(player_coords)
    _, nearest_player_indices = tree.query(grid_points, k=1)

    # Calculate physical inertia factors for modified players (quadratic penalty beyond 6.0m)
    player_inertia = np.ones(len(players), dtype=np.float64)
    for idx, p in enumerate(players):
        if p.is_modified and p.original_x is not None and p.original_y is not None:
            delta_d = math.hypot(p.x - p.original_x, p.y - p.original_y)
            if delta_d > 6.0:
                player_inertia[idx] = 1.0 / (1.0 + 0.008 * ((delta_d - 6.0) ** 2))

    # Weight territory cells if ball position is provided
    if ball_x is not None and ball_y is not None:
        ball_pos = np.array([ball_x, ball_y], dtype=np.float64)
        dist_to_ball = np.linalg.norm(grid_points - ball_pos, axis=1)
        ball_weights = np.exp(-dist_to_ball / 35.0)
        effective_weights = ball_weights * player_inertia[nearest_player_indices]

        home_cells = np.sum(effective_weights[is_home[nearest_player_indices]])
        total_cells = np.sum(effective_weights)
        pct = (home_cells / total_cells) * 100.0 if total_cells > 0 else 50.0
    else:
        effective_inertia = player_inertia[nearest_player_indices]
        home_cells = np.sum(is_home[nearest_player_indices] * effective_inertia)
        total_cells = np.sum(effective_inertia)
        pct = (home_cells / total_cells) * 100.0 if total_cells > 0 else 50.0

    return round(float(pct), 1)


# Backward-compatible alias
calculate_space_control_vectorized = calculate_space_control


# -----------------------------------------------------------------------------
# Gaussian Interception Cone Passing Lane Probability
# -----------------------------------------------------------------------------
def calculate_pass_probability_cone(
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    opponents: List[PlayerNode]
) -> float:
    """
    Evaluates pass completion probability on trajectory (start_x, start_y) -> (end_x, end_y)
    with a Gaussian interception shadow cone that widens along the vector.
    """
    dx = end_x - start_x
    dy = end_y - start_y
    pass_length = math.hypot(dx, dy)

    if pass_length < 1.0:
        return 96.0

    unit_x = dx / pass_length
    unit_y = dy / pass_length

    # Base probability decays with distance (longer passes have higher flight time)
    base_prob = max(35.0, 96.0 - 0.72 * pass_length)
    interception_multiplier = 1.0

    for opp in opponents:
        # Vector from passer to opponent
        opp_dx = opp.x - start_x
        opp_dy = opp.y - start_y

        # Orthogonal projection along the pass line: t in [0.0, 1.0]
        t = (opp_dx * unit_x + opp_dy * unit_y) / pass_length

        # Check if defender is positioned along the pass corridor
        if 0.05 < t < 0.98:
            # Perpendicular distance to pass segment
            d_perp = abs(dy * opp.x - dx * opp.y + end_x * start_y - end_y * start_x) / pass_length

            # Interception cone widens as the pass travels (uncertainty cone)
            sigma = 1.6 + 3.2 * t

            # Gaussian shadow
            shadow = math.exp(-(d_perp ** 2) / (2.0 * (sigma ** 2)))

            # Maximum obstruction if defender is directly on the vector
            interception_multiplier *= max(0.12, 1.0 - 0.88 * shadow)

    final_prob = base_prob * interception_multiplier
    return round(max(5.0, min(98.0, final_prob)), 1)


# -----------------------------------------------------------------------------
# Optimal Pass Target Identification
# -----------------------------------------------------------------------------
def find_optimal_pass_target(
    actor: PlayerNode,
    teammates: List[PlayerNode],
    opponents: List[PlayerNode]
) -> Tuple[Optional[int], float]:
    """
    Evaluates all teammates to find the highest Expected Value (EV = prob * xT).
    Returns (optimal_player_id, pass_completion_prob_to_optimal).
    """
    best_id: Optional[int] = None
    best_ev = -1.0
    best_prob = 50.0

    for mate in teammates:
        if mate.player_id == actor.player_id:
            continue

        prob = calculate_pass_probability_cone(
            start_x=actor.x,
            start_y=actor.y,
            end_x=mate.x,
            end_y=mate.y,
            opponents=opponents
        )
        target_xt = get_xt_at_point(mate.x, mate.y)
        ev = (prob / 100.0) * target_xt

        if ev > best_ev:
            best_ev = ev
            best_id = mate.player_id
            best_prob = prob

    return best_id, best_prob


# -----------------------------------------------------------------------------
# Main Simulation Recalculator
# -----------------------------------------------------------------------------
def simulate_counterfactual(
    base_frame: MatchFramePayload,
    modified_players: List[PlayerNode]
) -> MatchFramePayload:
    """
    Applies counterfactual player positions, recalculates Voronoi space control via Scipy cKDTree,
    evaluates pass completion with Gaussian cone, and recomputes Expected Threat (xT) via bilinear interpolation.
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

    # Find ball carrier / actor
    actor = next((p for p in updated_players if p.is_actor), updated_players[0])
    possession_team = base_frame.possession_team

    teammates = [p for p in updated_players if p.team == possession_team]
    opponents = [p for p in updated_players if p.team != possession_team]

    # Target coordinates of intended pass
    dest_x = base_frame.ball_end_x if base_frame.ball_end_x is not None else actor.x
    dest_y = base_frame.ball_end_y if base_frame.ball_end_y is not None else actor.y

    # 1. Recalculate pass completion probability for the primary pass
    primary_pass_prob = calculate_pass_probability_cone(
        start_x=base_frame.ball_x,
        start_y=base_frame.ball_y,
        end_x=dest_x,
        end_y=dest_y,
        opponents=opponents
    )

    # 2. Recalculate optimal pass target across all teammates
    optimal_id, _ = find_optimal_pass_target(actor, teammates, opponents)
    if optimal_id is None and len(teammates) > 1:
        other_mates = [m for m in teammates if m.player_id != actor.player_id]
        if other_mates:
            optimal_id = other_mates[0].player_id

    # 3. Recalculate space control on 60x40 fine grid via scipy.spatial.cKDTree
    space_home_pct = calculate_space_control(
        updated_players,
        ball_x=base_frame.ball_x,
        ball_y=base_frame.ball_y
    )

    # 4. Compute Simulated Expected Threat (xT) via 2D Bilinear Interpolation with recovery penalty
    base_target_xt = get_xt_at_point(dest_x, dest_y)
    recovery_xt_penalty = 0.03
    raw_simulated_xt = (
        base_target_xt * (primary_pass_prob / 100.0) + (1.0 - primary_pass_prob / 100.0) * recovery_xt_penalty
    )

    # Biomechanical inertia penalty if attacking actor moved beyond reaction envelope (>6.0m)
    inertia_penalty = 0.0
    for p in updated_players:
        if p.is_modified and p.is_actor and p.original_x is not None and p.original_y is not None:
            dist_moved = math.hypot(p.x - p.original_x, p.y - p.original_y)
            if dist_moved > 6.0:
                inertia_penalty += 0.008 * ((dist_moved - 6.0) ** 2)

    simulated_xt = round(max(0.02, raw_simulated_xt - inertia_penalty), 2)
    original_xt = round(base_frame.metrics.original_xt, 2)
    xt_delta = round(simulated_xt - original_xt, 2)

    new_metrics = TacticalMetrics(
        original_xt=original_xt,
        simulated_xt=simulated_xt,
        xt_delta=xt_delta,
        space_control_home_pct=space_home_pct,
        optimal_pass_target_id=optimal_id,
        pass_completion_prob=primary_pass_prob,
    )

    return base_frame.model_copy(
        update={
            "is_counterfactual_mode": True,
            "players": updated_players,
            "metrics": new_metrics,
        }
    )
