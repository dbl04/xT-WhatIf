"""
Tests for the xT Live Challenge game engine: action value, movement rules, optimiser and score.

Run: python backend/test_game_engine.py   (PYTHONPATH=./backend)
"""

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from app.schemas.match_contract import MatchFramePayload, TeamSide
from app.services.game_engine import (
    MAX_RADIUS_M,
    MAX_SCORE,
    MIN_MARGIN,
    action_value,
    analyse_moment,
    frame_value,
    mode_for,
    movable_players,
    offside_line,
    optimize,
    optimum_from_dict,
    optimum_to_dict,
    score_submission,
    validate_moves,
)
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.services.tactical_math import calculate_pass_probability_cone, find_optimal_pass_target, get_xt_at_point

FRAMES = [MatchFramePayload(**f) for f in loader.fetch_match_360_frames(DEFAULT_MATCH_ID)]
OPTIMA = {f.event_uuid: analyse_moment(f) for f in FRAMES}


def _carrier(frame):
    return next(p for p in frame.players if p.is_actor)


def _rules(violations):
    return {v.rule for v in violations}


class ActionValueTest(unittest.TestCase):
    def test_value_is_the_best_pass(self):
        for f in FRAMES:
            carrier = _carrier(f)
            opponents = [p for p in f.players if p.team != f.possession_team]
            expected = max(
                calculate_pass_probability_cone(f.ball_x, f.ball_y, p.x, p.y, opponents) / 100.0 * get_xt_at_point(p.x, p.y)
                for p in f.players
                if p.team == f.possession_team and not p.is_keeper and p.player_id != carrier.player_id
                and p.x <= offside_line(f) + 0.05
            )
            v = frame_value(f)
            self.assertAlmostEqual(v.value, expected, places=9)
            self.assertIsNotNone(v.target_id)

    def test_offside_teammate_cannot_receive(self):
        for f in FRAMES:
            target = frame_value(f).target_id
            if target is None:
                continue
            p = next(q for q in f.players if q.player_id == target)
            # Past the line of the untouched frame (no rule check here: only the value)
            v = frame_value(f, [(target, round(offside_line(f) + 3.0, 1), p.y)])
            self.assertNotEqual(v.target_id, target, f.moment_label)

    def test_sandbox_best_receiver_is_never_the_keeper_or_offside(self):
        # The sandbox's pick (tactical_math) follows the same rules as the game's (action_value).
        f = FRAMES[0]
        line = offside_line(f)
        actor = next(p for p in f.players if p.is_actor)
        mates = [p for p in f.players if p.team == f.possession_team]
        opponents = [p for p in f.players if p.team != f.possession_team]
        keeper_and_offside = [p if p.is_keeper or p.player_id == actor.player_id
                              else p.model_copy(update={"x": line + 3.0}) for p in mates]
        self.assertIsNone(find_optimal_pass_target(actor, keeper_and_offside, opponents, line)[0])

    def test_both_teams_change_the_value(self):
        """The legacy metric ignored attackers; V must move with attackers and defenders alike."""
        for f in FRAMES:
            report = OPTIMA[f.event_uuid]
            self.assertGreater(report.attack.best.value, report.attack.base.value, f.moment_label)
            self.assertLess(report.defend.best.value, report.defend.base.value, f.moment_label)

    def test_defender_on_the_lane_lowers_the_value(self):
        f = FRAMES[0]
        v = frame_value(f)
        target = next(p for p in f.players if p.player_id == v.target_id)
        mid = ((f.ball_x + target.x) / 2.0, (f.ball_y + target.y) / 2.0)
        defender = min(movable_players(f, "defend"), key=lambda p: math.hypot(p.x - mid[0], p.y - mid[1]))
        players = [p.model_copy(update={"x": mid[0], "y": mid[1]}) if p.player_id == defender.player_id else p
                   for p in f.players]
        self.assertLess(action_value(players, f.possession_team, f.ball_x, f.ball_y, offside_line(f)).value, v.value)


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.f = FRAMES[0]
        self.attackers = movable_players(self.f, "attack")
        self.defenders = movable_players(self.f, "defend")

    def _free_spot(self, p, dx=2.0, dy=0.0):
        return (p.player_id, round(p.x + dx, 1), round(p.y + dy, 1))

    def test_mode_follows_the_supported_team(self):
        other = TeamSide.AWAY if self.f.possession_team == TeamSide.HOME else TeamSide.HOME
        self.assertEqual(mode_for(self.f.possession_team, self.f), "attack")
        self.assertEqual(mode_for(other, self.f), "defend")

    def test_who_can_move(self):
        carrier = _carrier(self.f)
        self.assertNotIn(carrier.player_id, {p.player_id for p in self.attackers})
        self.assertTrue(all(not p.is_keeper for p in self.attackers + self.defenders))
        self.assertTrue(all(p.team == self.f.possession_team for p in self.attackers))
        self.assertTrue(all(p.team != self.f.possession_team for p in self.defenders))
        self.assertIn("not_movable", _rules(validate_moves(self.f, "attack", [(carrier.player_id, carrier.x - 1, carrier.y)])))
        d = self.defenders[0]
        self.assertIn("not_movable", _rules(validate_moves(self.f, "attack", [(d.player_id, d.x, d.y + 1)])))
        self.assertIn("unknown_player", _rules(validate_moves(self.f, "defend", [(999999, 50.0, 40.0)])))

    def test_at_most_two_players(self):
        moves = [(p.player_id, p.x, p.y) for p in self.defenders[:3]]
        self.assertIn("too_many", _rules(validate_moves(self.f, "defend", moves)))

    def test_radius_is_a_hard_limit(self):
        d = self.defenders[0]
        ok = validate_moves(self.f, "defend", [(d.player_id, d.x, round(d.y + MAX_RADIUS_M, 1))])
        far = validate_moves(self.f, "defend", [(d.player_id, d.x, round(d.y + MAX_RADIUS_M + 0.5, 1))])
        self.assertNotIn("too_far", _rules(ok))
        self.assertIn("too_far", _rules(far))

    def test_spacing_and_pitch(self):
        a, b = self.defenders[0], self.defenders[1]
        onto = validate_moves(self.f, "defend", [(a.player_id, b.x + 0.5, b.y)])
        if math.hypot(b.x + 0.5 - a.x, b.y - a.y) <= MAX_RADIUS_M:
            self.assertIn("too_close", _rules(onto))
        edge = min(self.defenders, key=lambda p: p.y)
        self.assertIn("off_pitch", _rules(validate_moves(self.f, "defend", [(edge.player_id, edge.x, -1.0)])))

    def test_offside(self):
        for f in FRAMES:
            line = offside_line(f)
            for p in movable_players(f, "attack"):
                beyond = (p.player_id, round(line + 1.0, 1), p.y)
                if math.hypot(line + 1.0 - p.x, 0) > MAX_RADIUS_M:
                    continue
                rules = _rules(validate_moves(f, "attack", [beyond]))
                if p.x <= line:
                    self.assertIn("offside", rules, (f.moment_label, p.name))
                else:
                    # Already beyond the line: may move, but cannot receive until back onside.
                    self.assertNotIn("offside", rules, (f.moment_label, p.name))

    def test_offside_does_not_apply_to_defenders(self):
        for f in FRAMES:
            for p in movable_players(f, "defend"):
                self.assertNotIn("offside", _rules(validate_moves(f, "defend", [(p.player_id, p.x + 1.0, p.y)])))


class OptimizerTest(unittest.TestCase):
    def test_optimum_is_legal_and_deterministic(self):
        for f in FRAMES:
            report = OPTIMA[f.event_uuid]
            for opt in (report.attack, report.defend):
                self.assertLessEqual(len(opt.moves), 2)
                self.assertEqual(validate_moves(f, opt.mode, opt.moves), [], (f.moment_label, opt.mode))
                self.assertAlmostEqual(frame_value(f, opt.moves).value, opt.best.value, places=9)
                self.assertLess(opt.compute_ms, 2000)
        again = optimize(FRAMES[0], "attack")
        self.assertEqual(again.moves, OPTIMA[FRAMES[0].event_uuid].attack.moves)

    def test_most_moments_have_room_to_play(self):
        """Regression guard for the pass model and the rules: the game needs headroom on both sides."""
        opens = [r for r in OPTIMA.values() if r.opens]
        self.assertGreaterEqual(len(opens), 5, {r.label: (r.attack.margin, r.defend.margin) for r in OPTIMA.values()})
        self.assertTrue(all(r.defend.margin >= MIN_MARGIN for r in OPTIMA.values()))

    def test_optimum_json_round_trip(self):
        for f in FRAMES:
            report = OPTIMA[f.event_uuid]
            for opt in (report.attack, report.defend):
                raw = json.loads(json.dumps(optimum_to_dict(opt)))
                restored = optimum_from_dict(raw)
                self.assertEqual(restored, opt)
                self.assertAlmostEqual(restored.margin, opt.margin, places=12)


class ScoreTest(unittest.TestCase):
    def test_attack_scale(self):
        self.assertEqual(score_submission("attack", 0.20, 0.30, 0.20), (0, False))
        self.assertEqual(score_submission("attack", 0.20, 0.30, 0.25), (500, False))
        self.assertEqual(score_submission("attack", 0.20, 0.30, 0.30), (MAX_SCORE, False))
        self.assertEqual(score_submission("attack", 0.20, 0.30, 0.15), (0, False))
        self.assertEqual(score_submission("attack", 0.20, 0.30, 0.34), (MAX_SCORE, True))

    def test_defend_scale_is_mirrored(self):
        self.assertEqual(score_submission("defend", 0.20, 0.10, 0.15), (500, False))
        self.assertEqual(score_submission("defend", 0.20, 0.10, 0.25), (0, False))
        self.assertEqual(score_submission("defend", 0.20, 0.10, 0.05), (MAX_SCORE, True))

    def test_no_margin_scores_zero(self):
        self.assertEqual(score_submission("attack", 0.20, 0.20, 0.25), (0, False))

    def test_optimum_scores_full_marks(self):
        for f in FRAMES:
            report = OPTIMA[f.event_uuid]
            for opt in (report.attack, report.defend):
                self.assertEqual(score_submission(opt.mode, opt.base.value, opt.best.value, opt.best.value)[0], MAX_SCORE)


class EvaluateApiTest(unittest.TestCase):
    def test_practice_evaluate_endpoint_and_four_audiences(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        frame = FRAMES[0]
        opt = OPTIMA[frame.event_uuid].attack
        moves = [{"player_id": pid, "x": x, "y": y} for pid, x, y in opt.moves]

        headlines_by_audience = {}
        for aud in ("casual", "analyst", "coach", "audio_description"):
            res = client.post(
                "/api/v1/game/evaluate",
                json={
                    "match_id": frame.match_id,
                    "event_uuid": frame.event_uuid,
                    "team": frame.possession_team,
                    "moves": moves,
                    "language": "es",
                    "audience": aud,
                },
            )
            self.assertEqual(res.status_code, 200, res.text)
            payload = res.json()
            self.assertEqual(payload["your_score"], MAX_SCORE)
            self.assertEqual(len(payload["pundits"]), 2)
            headlines_by_audience[aud] = (
                payload["explanation"]["voronoi_comparison"],
                payload["explanation"]["bianchi_headline"],
            )

        # Verify that the 4 audience modes generate distinct tailored commentary
        self.assertEqual(len(set(headlines_by_audience.values())), 4, headlines_by_audience)


if __name__ == "__main__":
    unittest.main(verbosity=2)
