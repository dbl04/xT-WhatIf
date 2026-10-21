"""
Synthetic, football-realistic match generator for xT-WhatIf.

Produces 360-style freeze-frames (all 22 players + ball) for a fictional fixture,
fully deterministic for a given seed. No real clubs, players or match data are used.

How a frame is built
--------------------
Coordinates follow the 120x80 convention used across the engine, with the team in
possession always attacking towards x = 120.

1. A scenario template fixes the event (carry, through ball, cut-back, shot...), the
   ball origin/destination, which role carries the ball and which role receives it.
2. Both teams are placed by role from the ball position and match phase:
   - attacking side in a 4-3-3: rest-defence centre-backs, high full-backs, wingers
     holding width, striker on the last line;
   - defending side in a compact 4-5-1 block: back line goal-side of the ball and
     shifted towards it, midfield line ~12 m ahead, lone striker screening.
3. The nearest defender presses the ball carrier, the receiver is placed on the pass
   destination, Gaussian noise is added and players are pushed apart (>= 1.8 m).
4. Metrics are computed with the same engine used for counterfactuals
   (`simulate_counterfactual` with no moved players), so an untouched frame always
   has a delta xT of exactly 0.

Usage
-----
    python -m app.services.synthetic_generator --seed 7 --write
"""

from __future__ import annotations

import argparse
import json
import math
import random
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.schemas.match_contract import (
    MatchFramePayload,
    MatchInfo,
    PlayerNode,
    TacticalMetrics,
    TeamInfo,
    TeamSide,
)
from app.services.narration import (
    AUDIENCES,
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    LANGUAGES,
    base_debate,
    localize_frame,
    moment_label,
)
from app.services.tactical_math import simulate_counterfactual

PITCH_LENGTH = 120.0
PITCH_WIDTH = 80.0
MIN_PLAYER_SPACING_M = 1.8
POSITION_NOISE_SD_M = 1.6

# Fictional fixture. Kit colours match the frontend palette (home celeste, away white).
HOME_TEAM = TeamInfo(name="Redmoor Albion", short_name="RDM", primary_color="#75aadb")
AWAY_TEAM = TeamInfo(name="Saltmarsh Rovers", short_name="SMR", primary_color="#f4f0f8")
COMPETITION = "Synthetic League · Matchday 7"
VENUE = "Harbourside Park"

# Catalogue of generated matches: match_id -> seed.
SYNTHETIC_MATCHES: Dict[int, int] = {900001: 7}
DEFAULT_MATCH_ID = 900001

# (name, shirt number, role). Names are invented.
HOME_SQUAD: List[Tuple[str, int, str]] = [
    ("K. Varnell", 1, "GK"),
    ("D. Okonne", 2, "RB"),
    ("L. Moravek", 4, "RCB"),
    ("S. Brennick", 5, "LCB"),
    ("A. Lindgard", 3, "LB"),
    ("J. Castellan", 6, "DM"),
    ("M. Ferrant", 8, "RCM"),
    ("R. Nakamuro", 10, "LCM"),
    ("E. Adeyo", 7, "RW"),
    ("P. Dufrain", 11, "LW"),
    ("O. Thornwell", 9, "ST"),
]
AWAY_SQUAD: List[Tuple[str, int, str]] = [
    ("V. Sorvik", 1, "GK"),
    ("H. Penhall", 2, "RB"),
    ("T. Quintal", 5, "RCB"),
    ("B. Drageth", 4, "LCB"),
    ("G. Esquivo", 3, "LB"),
    ("N. Haldorsen", 6, "DM"),
    ("C. Marrow", 8, "RCM"),
    ("I. Kowalin", 10, "LCM"),
    ("F. Albarra", 7, "RW"),
    ("Y. Belcourt", 11, "LW"),
    ("Z. Ombrell", 9, "ST"),
]
HOME_ID_BASE = 100
AWAY_ID_BASE = 200


@dataclass(frozen=True)
class Scenario:
    key: str  # also the narration key of the moment (narration.MOMENT_LABELS)
    event_type: str
    ball: Tuple[float, float]
    ball_end: Tuple[float, float]
    actor_role: str
    receiver_role: Optional[str] = None
    press_distance_m: float = 2.5
    # Override for the defending back line (attacking-direction x). None = derived from ball.
    def_line_x: Optional[float] = None
    keeper_rush_x: Optional[float] = None
    # Defenders are kept at least this far (m) from the ball's path: the action was played
    # through a gap, as it would be in a real match.
    lane_clearance_m: float = 4.5


# Coordinates are expressed with the attacking team going towards x = 120.
# With y < 40 on the attacking team's right-hand side (RB / RW).
SCENARIOS: List[Scenario] = [
    Scenario("wide_carry", "Dribble",
             ball=(97.0, 13.0), ball_end=(106.0, 24.0), actor_role="RW", press_distance_m=2.2),
    Scenario("counter_through", "Pass",
             ball=(60.0, 46.0), ball_end=(91.0, 34.0), actor_role="LCM", receiver_role="ST",
             press_distance_m=3.5, def_line_x=74.0, lane_clearance_m=5.0),
    Scenario("cutback", "Pass",
             ball=(113.0, 71.0), ball_end=(103.0, 45.0), actor_role="LW", receiver_role="RCM",
             press_distance_m=2.0),
    Scenario("half_space", "Pass",
             ball=(87.0, 28.0), ball_end=(103.0, 33.0), actor_role="RCM", receiver_role="ST",
             press_distance_m=3.0),
    Scenario("switch", "Pass",
             ball=(71.0, 11.0), ball_end=(86.0, 70.0), actor_role="RB", receiver_role="LW",
             press_distance_m=3.0),
    Scenario("edge_shot", "Shot",
             ball=(97.0, 37.0), ball_end=(120.0, 38.5), actor_role="LCM", press_distance_m=2.4,
             lane_clearance_m=3.5),
    Scenario("one_v_one", "Shot",
             ball=(106.0, 44.0), ball_end=(120.0, 41.0), actor_role="ST", press_distance_m=3.2,
             keeper_rush_x=112.5, lane_clearance_m=3.0),
]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _attacking_anchors(bx: float, by: float, def_line: float) -> Dict[str, Tuple[float, float]]:
    """4-3-3 in possession, everything relative to the ball and the opponent's last line."""
    lean = (by - 40.0)  # how far the ball is from the centre, in metres
    last_line = def_line - 1.0  # forwards stay onside
    return {
        "GK": (_clamp(bx * 0.22 + 4.0, 5.0, 28.0), 40.0),
        "RCB": (_clamp(bx - 36.0, 24.0, 68.0), _clamp(31.0 + lean * 0.25, 18.0, 42.0)),
        "LCB": (_clamp(bx - 36.0, 24.0, 68.0), _clamp(49.0 + lean * 0.25, 38.0, 62.0)),
        "RB": (_clamp(bx - 12.0, 30.0, 104.0), _clamp(9.0 + max(0.0, lean) * 0.25, 4.0, 22.0)),
        "LB": (_clamp(bx - 12.0, 30.0, 104.0), _clamp(71.0 + min(0.0, lean) * 0.25, 58.0, 76.0)),
        "DM": (_clamp(bx - 19.0, 30.0, 92.0), _clamp(40.0 + lean * 0.35, 24.0, 56.0)),
        "RCM": (_clamp(bx - 6.0, 36.0, 104.0), _clamp(27.0 + lean * 0.45, 12.0, 46.0)),
        "LCM": (_clamp(bx - 6.0, 36.0, 104.0), _clamp(53.0 + lean * 0.45, 34.0, 68.0)),
        "RW": (_clamp(max(bx + 4.0, last_line - 6.0), 50.0, last_line), 6.0),
        "LW": (_clamp(max(bx + 4.0, last_line - 6.0), 50.0, last_line), 74.0),
        "ST": (_clamp(last_line, 55.0, 110.0), _clamp(40.0 + lean * 0.3, 26.0, 54.0)),
    }


def _defending_anchors(bx: float, by: float, def_line: float, keeper_rush_x: Optional[float]
                       ) -> Dict[str, Tuple[float, float]]:
    """Compact 4-5-1 block defending the goal at x = 120, shifted towards the ball."""
    cy = _clamp(40.0 + (by - 40.0) * 0.55, 22.0, 58.0)  # block centre follows the ball
    mid_line = def_line - 12.0
    keeper_x = keeper_rush_x if keeper_rush_x is not None else 120.0 - min(14.0, (120.0 - def_line) * 0.35)
    return {
        "GK": (_clamp(keeper_x, 104.0, 119.0), _clamp(40.0 + (by - 40.0) * 0.15, 34.0, 46.0)),
        # Defending team's right side is the attacker's left (y > 40).
        "LB": (def_line, _clamp(cy - 18.0, 3.0, 50.0)),
        "LCB": (def_line + 0.5, _clamp(cy - 6.0, 10.0, 60.0)),
        "RCB": (def_line + 0.5, _clamp(cy + 6.0, 20.0, 70.0)),
        "RB": (def_line, _clamp(cy + 18.0, 30.0, 77.0)),
        "LW": (mid_line, _clamp(cy - 20.0, 3.0, 45.0)),
        "LCM": (mid_line + 1.0, _clamp(cy - 9.0, 10.0, 55.0)),
        "DM": (mid_line + 3.0, cy),
        "RCM": (mid_line + 1.0, _clamp(cy + 9.0, 25.0, 70.0)),
        "RW": (mid_line, _clamp(cy + 20.0, 35.0, 77.0)),
        "ST": (_clamp(def_line - 28.0, 40.0, 95.0), _clamp(40.0 + (by - 40.0) * 0.3, 28.0, 52.0)),
    }


def _defensive_line_x(bx: float, scenario: Scenario) -> float:
    if scenario.def_line_x is not None:
        return scenario.def_line_x
    # Goal-side of the ball, never deeper than the six-yard box area.
    return _clamp(bx + 7.0, 66.0, 112.5)


def _separate(points: Dict[int, List[float]], fixed: set, iterations: int = 30) -> None:
    """Pushes players apart until no pair is closer than MIN_PLAYER_SPACING_M."""
    ids = list(points)
    for _ in range(iterations):
        moved = False
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                ax, ay = points[a]
                bx, by = points[b]
                d = math.hypot(ax - bx, ay - by)
                if d >= MIN_PLAYER_SPACING_M:
                    continue
                moved = True
                if d < 1e-6:
                    ux, uy, d = 1.0, 0.0, 0.0
                else:
                    ux, uy = (ax - bx) / d, (ay - by) / d
                push = (MIN_PLAYER_SPACING_M - d) / 2.0
                if a not in fixed:
                    points[a] = [ax + ux * push, ay + uy * push]
                if b not in fixed:
                    points[b] = [bx - ux * push, by - uy * push]
        if not moved:
            return


def _clear_lane(points: Dict[int, List[float]], movable: List[int], start: Tuple[float, float],
                end: Tuple[float, float], clearance: float) -> None:
    """Moves defenders sitting on the ball's path sideways until they are `clearance` m away."""
    sx, sy = start
    dx, dy = end[0] - sx, end[1] - sy
    length = math.hypot(dx, dy)
    if length < 1.0:
        return
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux  # unit normal to the path
    for pid in movable:
        px, py = points[pid]
        t = ((px - sx) * ux + (py - sy) * uy) / length
        if not 0.05 < t < 0.98:
            continue
        # The interception cone widens along the path, so the gap does too.
        needed = clearance + 2.5 * t
        side = (px - sx) * nx + (py - sy) * ny
        if abs(side) >= needed:
            continue
        sign = 1.0 if side >= 0 else -1.0
        shift = sign * needed - side
        points[pid] = [px + nx * shift, py + ny * shift]


def _build_players(scenario: Scenario, possession: TeamSide, rng: random.Random) -> List[PlayerNode]:
    bx, by = scenario.ball
    ex, ey = scenario.ball_end
    def_line = _defensive_line_x(bx, scenario)

    attacking_squad, attacking_base = (HOME_SQUAD, HOME_ID_BASE) if possession == TeamSide.HOME else (AWAY_SQUAD, AWAY_ID_BASE)
    defending_squad, defending_base = (AWAY_SQUAD, AWAY_ID_BASE) if possession == TeamSide.HOME else (HOME_SQUAD, HOME_ID_BASE)
    attacking_side = possession
    defending_side = TeamSide.AWAY if possession == TeamSide.HOME else TeamSide.HOME

    att_anchor = _attacking_anchors(bx, by, def_line)
    def_anchor = _defending_anchors(bx, by, def_line, scenario.keeper_rush_x)

    points: Dict[int, List[float]] = {}
    meta: Dict[int, Tuple[str, int, TeamSide, str]] = {}
    fixed: set = set()

    def jitter(x: float, y: float, sd: float = POSITION_NOISE_SD_M) -> List[float]:
        return [x + rng.gauss(0.0, sd), y + rng.gauss(0.0, sd)]

    actor_id = receiver_id = None
    for name, number, role in attacking_squad:
        pid = attacking_base + number
        meta[pid] = (name, number, attacking_side, role)
        if role == scenario.actor_role:
            points[pid] = [bx, by]
            actor_id = pid
            fixed.add(pid)
        elif role == scenario.receiver_role:
            points[pid] = jitter(ex, ey, 0.6)
            receiver_id = pid
        else:
            ax, ay = att_anchor[role]
            points[pid] = jitter(ax, ay, 0.8 if role == "GK" else POSITION_NOISE_SD_M)

    for name, number, role in defending_squad:
        pid = defending_base + number
        meta[pid] = (name, number, defending_side, role)
        ax, ay = def_anchor[role]
        points[pid] = jitter(ax, ay, 0.5 if role == "GK" else POSITION_NOISE_SD_M)

    # Nearest outfield defender steps out to press the ball: goal-side, but angled off the
    # ball's path (the carrier plays around the presser, not through him).
    defenders = [pid for pid in points if meta[pid][2] == defending_side and meta[pid][3] != "GK"]
    presser = min(defenders, key=lambda pid: math.hypot(points[pid][0] - bx, points[pid][1] - by))
    goal_angle = math.atan2(40.0 - by, PITCH_LENGTH - bx)
    path_angle = math.atan2(ey - by, ex - bx)
    candidates = [goal_angle + sign * math.radians(rng.uniform(55.0, 80.0)) for sign in (-1.0, 1.0)]

    def off_path(angle: float) -> float:
        return abs(math.sin(angle - path_angle))

    press_angle = max(candidates, key=off_path)
    points[presser] = [bx + math.cos(press_angle) * scenario.press_distance_m,
                       by + math.sin(press_angle) * scenario.press_distance_m]

    lane_defenders = [pid for pid in defenders if pid != presser]
    _clear_lane(points, lane_defenders, (bx, by), (ex, ey), scenario.lane_clearance_m)

    _separate(points, fixed)
    # Separation can nudge someone back towards the lane; clear once more.
    _clear_lane(points, lane_defenders, (bx, by), (ex, ey), scenario.lane_clearance_m)

    players: List[PlayerNode] = []
    for pid, (x, y) in sorted(points.items()):
        name, number, side, role = meta[pid]
        x = round(_clamp(x, 0.5, PITCH_LENGTH - 0.5), 1)
        y = round(_clamp(y, 0.5, PITCH_WIDTH - 0.5), 1)
        players.append(PlayerNode(
            player_id=pid,
            name=name,
            jersey_number=number,
            team=side,
            is_actor=pid == actor_id,
            is_keeper=role == "GK",
            x=x,
            y=y,
            original_x=x,
            original_y=y,
            is_modified=False,
        ))
    return players


def _base_metrics(frame: MatchFramePayload) -> TacticalMetrics:
    """Engine metrics for the untouched frame; original == simulated so delta is 0."""
    evaluated = simulate_counterfactual(frame, [])
    m = evaluated.metrics
    return TacticalMetrics(
        original_xt=m.simulated_xt,
        simulated_xt=m.simulated_xt,
        xt_delta=0.0,
        space_control_home_pct=m.space_control_home_pct,
        optimal_pass_target_id=m.optimal_pass_target_id,
        pass_completion_prob=m.pass_completion_prob,
    )


def match_info(seed: int) -> MatchInfo:
    return MatchInfo(
        competition=COMPETITION,
        venue=VENUE,
        home=HOME_TEAM,
        away=AWAY_TEAM,
        data_source="synthetic",
        seed=seed,
    )


def generate_match(match_id: int = DEFAULT_MATCH_ID, seed: Optional[int] = None) -> List[MatchFramePayload]:
    """Generates the key moments of one synthetic match, in chronological order."""
    if seed is None:
        seed = SYNTHETIC_MATCHES.get(match_id, match_id)
    rng = random.Random(seed)
    info = match_info(seed)

    order = list(SCENARIOS)
    rng.shuffle(order)
    # Spread the moments across the 90 minutes.
    slot = 90.0 / len(order)
    frames: List[MatchFramePayload] = []
    for index, scenario in enumerate(order):
        minute = int(slot * index + rng.uniform(2.0, slot - 1.0))
        second = rng.randint(0, 59)
        possession = TeamSide.HOME if rng.random() < 0.55 else TeamSide.AWAY
        players = _build_players(scenario, possession, rng)
        frame = MatchFramePayload(
            match_id=match_id,
            event_uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, f"xt-whatif/synthetic/{seed}/{index}/{scenario.key}")),
            minute=minute,
            second=second,
            event_type=scenario.event_type,
            possession_team=possession,
            is_counterfactual_mode=False,
            ball_x=scenario.ball[0],
            ball_y=scenario.ball[1],
            ball_end_x=scenario.ball_end[0],
            ball_end_y=scenario.ball_end[1],
            players=players,
            metrics=TacticalMetrics(
                original_xt=0.0, simulated_xt=0.0, xt_delta=0.0,
                space_control_home_pct=50.0, optimal_pass_target_id=None, pass_completion_prob=50.0,
            ),
            agent_debate=[],
            moment_label=moment_label(scenario.key, DEFAULT_LANGUAGE),
            moment_key=scenario.key,
            match_info=info,
        )
        frame.metrics = _base_metrics(frame)
        # Committed fixtures carry the default profile; the API re-localises them per request.
        frame.agent_debate = base_debate(frame, frame.moment_label, DEFAULT_LANGUAGE, DEFAULT_AUDIENCE)
        frames.append(frame)
    return frames


# ----------------------------------------------------------------------------
# CLI: regenerate the committed fixtures (backend cache + frontend offline mocks)
# ----------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_CACHE_DIR = REPO_ROOT / "backend" / "app" / "data" / "cache"
FRONTEND_MOCKS_DIR = REPO_ROOT / "frontend" / "src" / "mocks"


def _dump(frames: List[MatchFramePayload]) -> str:
    return json.dumps([f.model_dump(mode="json") for f in frames], ensure_ascii=False, indent=2) + "\n"


def _dump_narration(frames: List[MatchFramePayload]) -> str:
    """Offline copy of the per-profile narration: {event_uuid: {lang: {audience: {moment_label, agent_debate}}}}."""
    table = {}
    for f in frames:
        table[f.event_uuid] = {}
        for lang in LANGUAGES:
            table[f.event_uuid][lang] = {}
            for audience in AUDIENCES:
                localized = localize_frame(f, lang, audience)
                table[f.event_uuid][lang][audience] = {
                    "moment_label": localized.moment_label,
                    "agent_debate": [m.model_dump(mode="json") for m in localized.agent_debate],
                }
    return json.dumps(table, ensure_ascii=False, indent=2) + "\n"


def write_fixtures(match_id: int, seed: Optional[int]) -> List[Path]:
    frames = generate_match(match_id, seed)
    text = _dump(frames)
    targets = [
        BACKEND_CACHE_DIR / f"match_{match_id}_frames.json",
        FRONTEND_MOCKS_DIR / f"match_{match_id}_frames.json",
    ]
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    narration = FRONTEND_MOCKS_DIR / f"match_{match_id}_narration.json"
    narration.write_text(_dump_narration(frames), encoding="utf-8")
    sample = FRONTEND_MOCKS_DIR / "sample_frame.json"
    sample.write_text(
        json.dumps(frames[0].model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return targets + [narration, sample]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic xT-WhatIf match frames.")
    parser.add_argument("--match-id", type=int, default=DEFAULT_MATCH_ID)
    parser.add_argument("--seed", type=int, default=None, help="Defaults to the catalogue seed for the match id.")
    parser.add_argument("--write", action="store_true", help="Write backend cache and frontend mock fixtures.")
    args = parser.parse_args()

    if args.write:
        for path in write_fixtures(args.match_id, args.seed):
            print(f"wrote {path.relative_to(REPO_ROOT)}")
    else:
        for f in generate_match(args.match_id, args.seed):
            print(f"{f.minute:>3}:{f.second:02d}  {f.event_type:<8} {f.possession_team.value:<4} "
                  f"xT={f.metrics.original_xt:.2f}  pass={f.metrics.pass_completion_prob:5.1f}%  {f.moment_label}")


if __name__ == "__main__":
    main()
