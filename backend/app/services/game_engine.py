"""
Game engine for the xT Live Challenge.

At a key moment every user moves up to two players: to raise the threat when the play
belongs to the team they support (attack) or to lower it when it belongs to the rival
(defend). This module holds the rules and the maths of that game, on top of the
geometric engine in tactical_math.py:

1. Action value V: expected value of the ball carrier's best pass,
       V = max_k P_pass(ball -> k) * xT(k), over teammates k who are onside
   Unlike the legacy "simulated xT" (fixed pass destination), V responds to both teams:
   an attacker who finds space raises it, a defender who closes a lane lowers it.
2. Movement rules (hard limits): who may move, how many, how far, spacing, offside.
3. Optimiser: the best legal move for a mode, searched over rings around each player.
4. Score: share of the optimum reached, 0-1000, comparable across moments and sides.

Usage (margin report for the committed key moments):
    python -m app.services.game_engine
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from itertools import combinations
from typing import Dict, Iterable, List, Literal, Optional, Sequence, Tuple

from app.schemas.match_contract import MatchFramePayload, PlayerNode, TeamSide
from app.services.tactical_math import (
    calculate_pass_probability_cone,
    get_xt_at_point,
    is_offside,
    offside_line_x,
)

GameMode = Literal["attack", "defend"]

PITCH_LENGTH = 120.0
PITCH_WIDTH = 80.0
MAX_MOVED_PLAYERS = 2
MAX_RADIUS_M = 6.0
MIN_SPACING_M = 1.8
# Tolerance for positions rounded to 0.1 m by the client.
_EPS = 0.05
# A moment is worth opening only if the best legal move changes V at least this much.
MIN_MARGIN = 0.03

# Candidate positions around each player for the optimiser: 8 directions x 3 radii (+ stay).
_RADII = (2.0, 4.0, MAX_RADIUS_M)
_ANGLES = tuple(i * math.pi / 4.0 for i in range(8))


Move = Tuple[int, float, float]  # (player_id, x, y)


@dataclass(frozen=True)
class ActionValue:
    value: float
    target_id: Optional[int]
    pass_prob: float  # 0-100, to the best target


@dataclass(frozen=True)
class RuleViolation:
    player_id: int
    rule: Literal["unknown_player", "not_movable", "too_many", "too_far", "off_pitch", "too_close", "offside"]
    detail: str


@dataclass
class Optimum:
    mode: GameMode
    base: ActionValue
    best: ActionValue
    moves: List[Move]
    evaluations: int
    compute_ms: float

    @property
    def margin(self) -> float:
        """How much the best legal move changes V, in the mode's favourable direction."""
        return _gain(self.mode, self.base.value, self.best.value)


@dataclass
class MomentReport:
    event_uuid: str
    label: Optional[str]
    attack: Optimum
    defend: Optimum
    playable: Dict[GameMode, bool] = field(default_factory=dict)

    @property
    def opens(self) -> bool:
        """The Validator opens a moment only if both sides (attack and defend) have something to find."""
        return all(self.playable.values())


# ---------------------------------------------------------------------------
# 1. Action value
# ---------------------------------------------------------------------------
def action_value(players: Sequence[PlayerNode], possession: TeamSide, ball_x: float, ball_y: float,
                 offside_x: Optional[float] = None) -> ActionValue:
    """
    Expected value of the best pass from the ball: max over onside teammates of P(pass) * xT(receiver).
    `offside_x` defaults to the line drawn by these same players.
    """
    carrier = _carrier(players, possession, ball_x, ball_y)
    opponents = [p for p in players if p.team != possession]
    if offside_x is None:
        offside_x = offside_line_x(list(players), possession, ball_x)
    best = ActionValue(0.0, None, 0.0)
    for mate in players:
        if (mate.team != possession or mate.player_id == carrier.player_id or mate.is_keeper
                or is_offside(mate, offside_x)):
            continue
        prob = calculate_pass_probability_cone(ball_x, ball_y, mate.x, mate.y, opponents)
        value = prob / 100.0 * get_xt_at_point(mate.x, mate.y)
        if value > best.value:
            best = ActionValue(value, mate.player_id, prob)
    return best


def frame_value(frame: MatchFramePayload, moves: Iterable[Move] = ()) -> ActionValue:
    """V after the moves, with the offside line of the untouched frame: stepping up plays nobody offside."""
    return action_value(apply_moves(frame.players, moves), frame.possession_team, frame.ball_x, frame.ball_y,
                        offside_line(frame))


def apply_moves(players: Sequence[PlayerNode], moves: Iterable[Move]) -> List[PlayerNode]:
    targets = {pid: (x, y) for pid, x, y in moves}
    out = []
    for p in players:
        if p.player_id in targets:
            x, y = targets[p.player_id]
            out.append(p.model_copy(update={
                "x": x, "y": y,
                "original_x": p.original_x if p.original_x is not None else p.x,
                "original_y": p.original_y if p.original_y is not None else p.y,
                "is_modified": True,
            }))
        else:
            out.append(p)
    return out


def _carrier(players: Sequence[PlayerNode], possession: TeamSide, ball_x: float, ball_y: float) -> PlayerNode:
    actor = next((p for p in players if p.is_actor), None)
    if actor is not None:
        return actor
    mates = [p for p in players if p.team == possession] or list(players)
    return min(mates, key=lambda p: math.hypot(p.x - ball_x, p.y - ball_y))


# ---------------------------------------------------------------------------
# 2. Movement rules
# ---------------------------------------------------------------------------
def mode_for(supported_team: TeamSide, frame: MatchFramePayload) -> GameMode:
    """Your team has the ball: attack. The rival has it: defend."""
    return "attack" if supported_team == frame.possession_team else "defend"


def movable_players(frame: MatchFramePayload, mode: GameMode) -> List[PlayerNode]:
    """Attack: the carrier's outfield teammates (not the carrier). Defend: outfield defenders."""
    carrier = _carrier(frame.players, frame.possession_team, frame.ball_x, frame.ball_y)
    if mode == "attack":
        return [p for p in frame.players
                if p.team == frame.possession_team and not p.is_keeper and p.player_id != carrier.player_id]
    return [p for p in frame.players if p.team != frame.possession_team and not p.is_keeper]


def offside_line(frame: MatchFramePayload) -> float:
    """
    Attackers who start onside may not cross the second-last defender, the ball or halfway,
    whichever is furthest. A player already beyond it may move, but cannot receive (see
    action_value) until back onside.
    """
    return offside_line_x(frame.players, frame.possession_team, frame.ball_x)


def validate_moves(frame: MatchFramePayload, mode: GameMode, moves: Sequence[Move]) -> List[RuleViolation]:
    """Every rule a set of moves breaks; an empty list means the moves are legal."""
    by_id = {p.player_id: p for p in frame.players}
    movable = {p.player_id for p in movable_players(frame, mode)}
    violations: List[RuleViolation] = []

    moved_ids = list(dict.fromkeys(pid for pid, _, _ in moves))
    if len(moved_ids) > MAX_MOVED_PLAYERS:
        for pid in moved_ids[MAX_MOVED_PLAYERS:]:
            violations.append(RuleViolation(pid, "too_many", f"at most {MAX_MOVED_PLAYERS} players may move"))

    line = offside_line(frame) if mode == "attack" else None
    final = {pid: (x, y) for pid, x, y in moves}
    positions = {p.player_id: final.get(p.player_id, (p.x, p.y)) for p in frame.players}

    for pid, (x, y) in final.items():
        p = by_id.get(pid)
        if p is None:
            violations.append(RuleViolation(pid, "unknown_player", "no such player in this moment"))
            continue
        if pid not in movable:
            violations.append(RuleViolation(pid, "not_movable", f"this player cannot move in {mode} mode"))
            continue
        if not (0.0 <= x <= PITCH_LENGTH and 0.0 <= y <= PITCH_WIDTH):
            violations.append(RuleViolation(pid, "off_pitch", "position outside the pitch"))
        ox = p.original_x if p.original_x is not None else p.x
        oy = p.original_y if p.original_y is not None else p.y
        dist = math.hypot(x - ox, y - oy)
        if dist > MAX_RADIUS_M + _EPS:
            violations.append(RuleViolation(pid, "too_far", f"moved {dist:.1f} m, limit {MAX_RADIUS_M:.0f} m"))
        nearest = min(
            (math.hypot(x - qx, y - qy) for qid, (qx, qy) in positions.items() if qid != pid),
            default=float("inf"),
        )
        if nearest < MIN_SPACING_M - _EPS:
            violations.append(RuleViolation(pid, "too_close", f"{nearest:.1f} m from another player, minimum {MIN_SPACING_M} m"))
        if line is not None and ox <= line + _EPS and x > line + _EPS:
            violations.append(RuleViolation(pid, "offside", f"beyond the offside line at x = {line:.1f}"))
    return violations


# ---------------------------------------------------------------------------
# 3. Optimiser
# ---------------------------------------------------------------------------
def _gain(mode: GameMode, base: float, value: float) -> float:
    return value - base if mode == "attack" else base - value


def _candidates(frame: MatchFramePayload, mode: GameMode, player: PlayerNode) -> List[Tuple[float, float]]:
    """Legal positions on rings around the player (checked alone, against the untouched frame)."""
    out = [(player.x, player.y)]
    for r in _RADII:
        for a in _ANGLES:
            x = round(player.x + r * math.cos(a), 1)
            y = round(player.y + r * math.sin(a), 1)
            if not validate_moves(frame, mode, [(player.player_id, x, y)]):
                out.append((x, y))
    return out


def optimize(frame: MatchFramePayload, mode: GameMode, shortlist: int = 5, per_player: int = 8) -> Optimum:
    """
    Best legal move of up to two players for a mode.

    1. Every movable player alone, on every candidate position.
    2. Pairs among the `shortlist` players with the largest single gain, over each one's
       `per_player` best positions.
    3. Two rounds of coordinate refinement on the best pair over all candidates.
    """
    t0 = time.perf_counter()
    base = frame_value(frame)
    evals = 0

    def score(moves: List[Move]) -> float:
        nonlocal evals
        evals += 1
        return _gain(mode, base.value, frame_value(frame, moves).value)

    cands: Dict[int, List[Tuple[float, float]]] = {}
    ranked: Dict[int, List[Tuple[float, Tuple[float, float]]]] = {}
    for p in movable_players(frame, mode):
        cands[p.player_id] = _candidates(frame, mode, p)
        ranked[p.player_id] = sorted(
            ((score([(p.player_id, x, y)]), (x, y)) for x, y in cands[p.player_id]),
            key=lambda item: item[0], reverse=True,
        )

    best_gain, best_moves = 0.0, []
    for pid, options in ranked.items():
        if options and options[0][0] > best_gain:
            best_gain, best_moves = options[0][0], [(pid, *options[0][1])]

    top = sorted(ranked, key=lambda pid: ranked[pid][0][0] if ranked[pid] else 0.0, reverse=True)[:shortlist]
    for a, b in combinations(top, 2):
        for _, (ax, ay) in ranked[a][:per_player]:
            for _, (bx, by) in ranked[b][:per_player]:
                moves = [(a, ax, ay), (b, bx, by)]
                if validate_moves(frame, mode, moves):
                    continue
                g = score(moves)
                if g > best_gain:
                    best_gain, best_moves = g, moves

    for _ in range(2 if len(best_moves) == 2 else 0):
        for i in range(2):
            other = best_moves[1 - i]
            pid = best_moves[i][0]
            for x, y in cands[pid]:
                moves = [other, (pid, x, y)]
                if validate_moves(frame, mode, moves):
                    continue
                g = score(moves)
                if g > best_gain:
                    best_gain, best_moves = g, sorted(moves)

    # Drop players whose "move" is staying put.
    by_id = {p.player_id: p for p in frame.players}
    best_moves = [m for m in best_moves if (m[1], m[2]) != (by_id[m[0]].x, by_id[m[0]].y)]
    return Optimum(
        mode=mode,
        base=base,
        best=frame_value(frame, best_moves),
        moves=best_moves,
        evaluations=evals,
        compute_ms=round((time.perf_counter() - t0) * 1000, 1),
    )


# ---------------------------------------------------------------------------
# 4. Score
# ---------------------------------------------------------------------------
MAX_SCORE = 1000


def score_submission(mode: GameMode, base_value: float, optimum_value: float, user_value: float) -> Tuple[int, bool]:
    """
    Share of the optimum reached, 0-1000, and whether the user beat the optimiser
    (it searches a grid of positions, so a sharper move can do better: capped at 1000).
    """
    max_gain = _gain(mode, base_value, optimum_value)
    if max_gain <= 1e-9:
        return 0, False
    ratio = _gain(mode, base_value, user_value) / max_gain
    return int(round(MAX_SCORE * max(0.0, min(1.0, ratio)))), ratio > 1.0 + 1e-9


# ---------------------------------------------------------------------------
# 5. Margin report
# ---------------------------------------------------------------------------
def analyse_moment(frame: MatchFramePayload, min_margin: float = MIN_MARGIN) -> MomentReport:
    attack, defend = optimize(frame, "attack"), optimize(frame, "defend")
    return MomentReport(
        event_uuid=frame.event_uuid,
        label=frame.moment_label,
        attack=attack,
        defend=defend,
        playable={"attack": attack.margin >= min_margin, "defend": defend.margin >= min_margin},
    )


def main() -> None:
    from app.services.match_loader import loader
    from app.services.synthetic_generator import DEFAULT_MATCH_ID

    frames = [MatchFramePayload(**f) for f in loader.fetch_match_360_frames(DEFAULT_MATCH_ID)]
    print(f"{'clock':>6}  {'moment':<34} {'V base':>7} {'atk opt':>8} {'margin':>7} {'def opt':>8} {'margin':>7}  {'ms':>6}")
    for f in frames:
        r = analyse_moment(f)
        flag = lambda mode: "" if r.playable[mode] else " *"
        print(f"{f.minute:>3}:{f.second:02d}  {(f.moment_label or f.event_type)[:34]:<34} {r.attack.base.value:7.3f} "
              f"{r.attack.best.value:8.3f} {r.attack.margin:7.3f}{flag('attack'):2} {r.defend.best.value:8.3f} "
              f"{r.defend.margin:7.3f}{flag('defend'):2} {r.attack.compute_ms + r.defend.compute_ms:6.0f}")
    print(f"* margin below {MIN_MARGIN}: the Validator would not open this moment")


if __name__ == "__main__":
    main()
