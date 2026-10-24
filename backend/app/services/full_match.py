"""
Full synthetic match for the live game: a 90-minute sequence of events, each with a
360-style freeze-frame (22 players + ball), possessions that progress up the pitch, shots
with an outcome and a running score. Deterministic for a seed; no real data is used.

The key-moment scenarios of synthetic_generator.py are reused as building blocks: every
event is a Scenario built on the fly from where the possession has taken the ball, and its
players are placed by role with the same `_build_players`.

Usage:
    python -m app.services.full_match --seed 11
"""

from __future__ import annotations

import argparse
import math
import random
import uuid
from typing import List, Optional, Tuple

from app.schemas.live import LiveEvent, Score
from app.schemas.match_contract import MatchFramePayload, TacticalMetrics, TeamSide
from app.services.narration import DEFAULT_LANGUAGE, moment_label
from app.services.synthetic_generator import Scenario, _base_metrics, _build_players, match_info
from app.services.tactical_math import get_xt_at_point

MATCH_SECONDS = 90 * 60
LIVE_MATCH_ID_BASE = 910000

# Shots are converted with probability xT(shot position) * this factor (~2-4 goals a match).
GOAL_FACTOR = 0.9
TURNOVER_PROB = 0.22
MAX_EVENTS_PER_POSSESSION = 6


def _role_for(x: float, y: float, exclude: Optional[str] = None) -> str:
    """Role most likely to have the ball at (x, y), attacking towards x = 120 (y < 40 = right)."""
    lane = 0 if y < 20 else 1 if y < 33 else 2 if y <= 47 else 3 if y <= 60 else 4
    if x < 40:
        options = ["RB", "RCB", "DM", "LCB", "LB"]
    elif x < 78:
        options = ["RB", "RCM", "DM", "LCM", "LB"]
    else:
        options = ["RW", "RCM", "ST", "LCM", "LW"]
    role = options[lane]
    if role == exclude:
        role = options[(lane + 1) % len(options)] if lane < 2 else options[lane - 1]
    return role


def _moment_key(event_type: str, start: Tuple[float, float], end: Tuple[float, float]) -> str:
    (sx, sy), (ex, ey) = start, end
    if event_type == "Shot":
        return "one_v_one" if math.hypot(120 - sx, 40 - sy) < 16 else "edge_shot"
    if event_type == "Dribble":
        return "wide_carry" if ex >= 95 else "carry"
    if sx >= 104 and (sy < 18 or sy > 62) and ex < sx:
        return "cutback"
    if abs(ey - sy) > 30 and sx >= 55:
        return "switch"
    if ex >= 95:
        return "counter_through" if sx < 70 else "half_space"
    return "buildup_pass" if sx < 60 else "progressive_pass"


def is_candidate(event: LiveEvent) -> bool:
    """
    Detector pre-filter (rules): shots and actions that reach the last 35 m or switch the play.
    Attackers stand onside, so passes ending short of the box still give both sides room to play.
    """
    f = event.frame
    return (
        f.event_type == "Shot"
        or (f.ball_end_x or 0) >= 85
        or f.moment_key in ("switch", "cutback", "wide_carry")
    )


def generate_full_match(seed: int, match_id: Optional[int] = None) -> List[LiveEvent]:
    """All events of one synthetic match in chronological order."""
    rng = random.Random(seed)
    match_id = match_id if match_id is not None else LIVE_MATCH_ID_BASE + seed
    info = match_info(seed)

    plan: List[Tuple[TeamSide, str, Tuple[float, float], Tuple[float, float], Optional[str]]] = []
    possession = TeamSide.HOME if rng.random() < 0.5 else TeamSide.AWAY
    while len(plan) < 64:
        x, y = rng.uniform(22, 48), rng.uniform(12, 68)
        for step in range(MAX_EVENTS_PER_POSSESSION):
            if x >= 86 and (rng.random() < 0.55 or step == MAX_EVENTS_PER_POSSESSION - 1):
                end = (120.0, rng.uniform(36.5, 43.5))
                p_goal = min(0.6, get_xt_at_point(x, y) * GOAL_FACTOR)
                outcome = "goal" if rng.random() < p_goal else rng.choice(["saved", "missed", "blocked"])
                plan.append((possession, "Shot", (x, y), end, outcome))
                break
            kind = "Dribble" if rng.random() < 0.22 else "Pass"
            if kind == "Dribble":
                ex, ey = x + rng.uniform(6, 12), y + rng.gauss(0, 4)
            elif x >= 104 and (y < 18 or y > 62):
                ex, ey = x - rng.uniform(6, 12), rng.uniform(34, 46)  # cut-back
            elif x >= 55 and rng.random() < 0.15:
                ex, ey = x + rng.uniform(8, 18), 80 - y + rng.gauss(0, 4)  # switch of play
            else:
                ex, ey = x + rng.uniform(8, 24), y + rng.gauss(0, 12)
            ex, ey = min(116.0, max(5.0, ex)), min(76.0, max(4.0, ey))
            lost = rng.random() < TURNOVER_PROB
            plan.append((possession, kind, (x, y), (ex, ey), "intercepted" if lost else "completed"))
            if lost:
                break
            x, y = ex, ey
        possession = TeamSide.AWAY if possession == TeamSide.HOME else TeamSide.HOME

    clock = sorted(rng.uniform(30, MATCH_SECONDS - 30) for _ in plan)
    score = {TeamSide.HOME: 0, TeamSide.AWAY: 0}
    events: List[LiveEvent] = []
    for index, ((side, kind, start, end, outcome), at) in enumerate(zip(plan, clock)):
        key = _moment_key(kind, start, end)
        actor = _role_for(*start)
        receiver = None if kind in ("Shot", "Dribble") else _role_for(*end, exclude=actor)
        scenario = Scenario(
            key, kind, ball=start, ball_end=end, actor_role=actor, receiver_role=receiver,
            press_distance_m=rng.uniform(2.0, 3.5), lane_clearance_m=2.0 if kind == "Shot" else 2.5,
        )
        frame = MatchFramePayload(
            match_id=match_id,
            event_uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, f"xt-whatif/live/{seed}/{index}")),
            minute=int(at // 60),
            second=int(at % 60),
            event_type=kind,
            possession_team=side,
            ball_x=round(start[0], 1),
            ball_y=round(start[1], 1),
            ball_end_x=round(end[0], 1),
            ball_end_y=round(end[1], 1),
            players=_build_players(scenario, side, rng),
            metrics=TacticalMetrics(original_xt=0.0, simulated_xt=0.0, xt_delta=0.0,
                                    space_control_home_pct=50.0, pass_completion_prob=50.0),
            agent_debate=[],
            moment_label=moment_label(key, DEFAULT_LANGUAGE),
            moment_key=key,
            match_info=info,
        )
        frame.metrics = _base_metrics(frame)
        if outcome == "goal":
            score[side] += 1
        event = LiveEvent(
            index=index,
            match_seconds=round(at, 1),
            frame=frame,
            outcome=outcome,
            score=Score(home=score[TeamSide.HOME], away=score[TeamSide.AWAY]),
        )
        event.candidate = is_candidate(event)
        events.append(event)
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description="Print a full synthetic match.")
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    for e in generate_full_match(args.seed):
        f = e.frame
        mark = "*" if e.candidate else " "
        print(f"{mark} {f.minute:>2}:{f.second:02d} {f.possession_team.value:<4} {f.event_type:<7} "
              f"{(f.moment_label or '')[:34]:<34} {e.outcome:<11} {e.score.home}-{e.score.away}")


if __name__ == "__main__":
    main()
