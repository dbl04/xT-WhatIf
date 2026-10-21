"""
Tests for the synthetic match generator (app/services/synthetic_generator.py).

Run: python backend/test_synthetic_generator.py   (PYTHONPATH=./backend)
"""

import itertools
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from app.schemas.match_contract import MatchFramePayload, TeamSide
from app.services.synthetic_generator import (
    BACKEND_CACHE_DIR,
    DEFAULT_MATCH_ID,
    FRONTEND_MOCKS_DIR,
    MIN_PLAYER_SPACING_M,
    SCENARIOS,
    _dump,
    generate_match,
)
from app.services.tactical_math import simulate_counterfactual


class TestSyntheticGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = generate_match(DEFAULT_MATCH_ID)

    def test_deterministic_for_a_seed(self):
        self.assertEqual(_dump(generate_match(DEFAULT_MATCH_ID)), _dump(self.frames))
        self.assertNotEqual(_dump(generate_match(DEFAULT_MATCH_ID, seed=8)), _dump(self.frames))

    def test_one_frame_per_scenario_in_chronological_order(self):
        self.assertEqual(len(self.frames), len(SCENARIOS))
        clocks = [f.minute * 60 + f.second for f in self.frames]
        self.assertEqual(clocks, sorted(clocks))
        self.assertTrue(all(0 <= f.minute <= 90 for f in self.frames))
        self.assertEqual(len({f.event_uuid for f in self.frames}), len(self.frames))

    def test_full_squads_on_the_pitch(self):
        for f in self.frames:
            ids = [p.player_id for p in f.players]
            self.assertEqual(len(ids), 22)
            self.assertEqual(len(set(ids)), 22)
            for side in (TeamSide.HOME, TeamSide.AWAY):
                team = [p for p in f.players if p.team == side]
                self.assertEqual(len(team), 11)
                self.assertEqual(sum(p.is_keeper for p in team), 1)
            actors = [p for p in f.players if p.is_actor]
            self.assertEqual(len(actors), 1)
            self.assertEqual(actors[0].team, f.possession_team)
            self.assertEqual((actors[0].x, actors[0].y), (f.ball_x, f.ball_y))

    def test_positions_are_on_the_pitch_and_spaced(self):
        for f in self.frames:
            for p in f.players:
                self.assertTrue(0.0 <= p.x <= 120.0 and 0.0 <= p.y <= 80.0, (f.moment_label, p.name))
                self.assertEqual((p.original_x, p.original_y), (p.x, p.y))
                self.assertFalse(p.is_modified)
            closest = min(math.hypot(a.x - b.x, a.y - b.y) for a, b in itertools.combinations(f.players, 2))
            # Rounding to 0.1 m and pitch clamping can shave a few centimetres.
            self.assertGreaterEqual(closest, MIN_PLAYER_SPACING_M - 0.3, f.moment_label)

    def test_keepers_guard_their_own_goal(self):
        for f in self.frames:
            attacking_gk = next(p for p in f.players if p.is_keeper and p.team == f.possession_team)
            defending_gk = next(p for p in f.players if p.is_keeper and p.team != f.possession_team)
            self.assertLess(attacking_gk.x, 30.0)
            self.assertGreater(defending_gk.x, 100.0)

    def test_untouched_frame_has_zero_delta(self):
        for f in self.frames:
            self.assertFalse(f.is_counterfactual_mode)
            self.assertEqual(f.metrics.xt_delta, 0.0)
            self.assertEqual(f.metrics.original_xt, f.metrics.simulated_xt)
            replay = simulate_counterfactual(f, [])
            self.assertEqual(replay.metrics.xt_delta, 0.0, f.moment_label)

    def test_metrics_are_plausible(self):
        for f in self.frames:
            self.assertTrue(0.02 <= f.metrics.original_xt <= 0.65, (f.moment_label, f.metrics.original_xt))
            self.assertTrue(5.0 <= f.metrics.pass_completion_prob <= 98.0)
            if f.event_type == "Pass":
                # Passes are played through gaps; the lane should not be fully closed.
                self.assertGreater(f.metrics.pass_completion_prob, 20.0, f.moment_label)

    def test_moving_a_defender_changes_the_outcome(self):
        f = next(fr for fr in self.frames if fr.event_type == "Pass")
        defenders = [p for p in f.players if p.team != f.possession_team and not p.is_keeper]
        mid_x = (f.ball_x + f.ball_end_x) / 2.0
        mid_y = (f.ball_y + f.ball_end_y) / 2.0
        d = min(defenders, key=lambda p: math.hypot(p.x - mid_x, p.y - mid_y))
        moved = d.model_copy(update={"x": round(mid_x, 1), "y": round(mid_y, 1), "is_modified": True})
        sim = simulate_counterfactual(f, [moved])
        self.assertLess(sim.metrics.xt_delta, 0.0)

    def test_metadata_is_synthetic(self):
        for f in self.frames:
            self.assertIsNotNone(f.match_info)
            self.assertEqual(f.match_info.data_source, "synthetic")
            self.assertTrue(f.moment_label)
            self.assertEqual(len(f.agent_debate), 2)

    def _assert_close(self, committed, generated, path, where="root"):
        """Exact on structure, ids and text; numbers within a tolerance (libm differs across OSes)."""
        hint = f"{path.name} is stale at {where}: run `python -m app.services.synthetic_generator --write` from backend/"
        if isinstance(generated, dict):
            self.assertEqual(set(committed), set(generated), hint)
            for k in generated:
                self._assert_close(committed[k], generated[k], path, f"{where}.{k}")
        elif isinstance(generated, list):
            self.assertEqual(len(committed), len(generated), hint)
            for i, (c, g) in enumerate(zip(committed, generated)):
                self._assert_close(c, g, path, f"{where}[{i}]")
        elif isinstance(generated, float) and not isinstance(generated, bool):
            self.assertAlmostEqual(committed, generated, delta=0.25, msg=hint)
        else:
            self.assertEqual(committed, generated, hint)

    def test_committed_fixtures_match_the_generator(self):
        generated = json.loads(_dump(self.frames))
        for path in (
            BACKEND_CACHE_DIR / f"match_{DEFAULT_MATCH_ID}_frames.json",
            FRONTEND_MOCKS_DIR / f"match_{DEFAULT_MATCH_ID}_frames.json",
        ):
            self.assertTrue(path.exists(), path)
            committed = json.loads(path.read_text(encoding="utf-8"))
            # Debate text embeds rounded numbers; compare it only where it is number-free.
            for frame in committed + generated:
                for msg in frame["agent_debate"]:
                    for key in ("headline", "analysis_body", "referenced_metric"):
                        msg[key] = "".join(ch for ch in msg[key] if not ch.isdigit())
            self._assert_close(committed, generated, path)
            # And they load back into the contract.
            [MatchFramePayload(**f) for f in committed]


if __name__ == "__main__":
    unittest.main(verbosity=2)
