"""
Tests for the personalised narration (language x audience profile).

Run: python backend/test_narration.py   (PYTHONPATH=./backend)
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

from app.core import rate_limit
from app.main import app
from app.schemas.match_contract import AgentRole, MatchFramePayload
from app.services.match_loader import loader
from app.services.narration import (
    AGENT_NAMES,
    AUDIENCES,
    LANGUAGES,
    MOMENT_LABELS,
    counterfactual_debate,
    describe_spot,
    localize_frame,
)
from app.services.synthetic_generator import DEFAULT_MATCH_ID, FRONTEND_MOCKS_DIR, _dump_narration, generate_match
from app.services.tactical_math import simulate_counterfactual


def _frames():
    return [MatchFramePayload(**f) for f in loader.fetch_match_360_frames(DEFAULT_MATCH_ID)]


def _moved(frame: MatchFramePayload, dx: float):
    defender = next(p for p in frame.players if p.team != frame.possession_team and not p.is_keeper)
    return defender.model_copy(update={
        "x": round(min(119.0, max(1.0, defender.x + dx)), 1),
        "original_x": defender.x,
        "original_y": defender.y,
        "is_modified": True,
    })


class NarrationTemplatesTest(unittest.TestCase):
    def test_every_profile_renders_every_case(self):
        """No missing placeholders, right agent names, for falling, rising and flat threat."""
        for frame in _frames():
            for dx in (-5.0, 0.0, 5.0):
                sim = simulate_counterfactual(frame, [_moved(frame, dx)])
                for lang in LANGUAGES:
                    for audience in AUDIENCES:
                        debate = counterfactual_debate(sim, lang, audience)
                        self.assertEqual([m.agent_role for m in debate],
                                         [AgentRole.DATA_SCIENTIST, AgentRole.CLASSIC_COACH])
                        for msg in debate:
                            self.assertEqual(msg.agent_name, AGENT_NAMES[lang][msg.agent_role])
                            for text in (msg.headline, msg.analysis_body, msg.referenced_metric):
                                self.assertTrue(text.strip())
                                self.assertNotIn("{", text, (lang, audience, text))

    def test_base_debate_is_localised(self):
        frame = _frames()[0]
        en = localize_frame(frame, "en", "analyst")
        es = localize_frame(frame, "es", "analyst")
        self.assertEqual(en.moment_label, MOMENT_LABELS[frame.moment_key]["en"])
        self.assertEqual(es.moment_label, MOMENT_LABELS[frame.moment_key]["es"])
        self.assertIn("Míster Bianchi", es.agent_debate[1].agent_name)
        self.assertIn("Coach Bianchi", en.agent_debate[1].agent_name)
        # The original frame is not mutated.
        self.assertEqual(frame.agent_debate[0].message_id, _frames()[0].agent_debate[0].message_id)

    def test_audio_description_avoids_coordinates(self):
        for frame in _frames():
            for lang in LANGUAGES:
                for msg in localize_frame(frame, lang, "audio_description").agent_debate:
                    self.assertNotIn("(", msg.analysis_body)
                    self.assertNotIn("xT", msg.analysis_body)

    def test_describe_spot(self):
        self.assertEqual(describe_spot(110, 40, "en"), "inside the penalty area")
        self.assertEqual(describe_spot(110, 40, "es"), "dentro del área")
        self.assertIn("right wing", describe_spot(90, 5, "en"))
        self.assertIn("banda izquierda", describe_spot(90, 75, "es"))
        self.assertEqual(describe_spot(30, 40, "en"), "in their own half")

    def test_offline_narration_fixture_is_current(self):
        path = FRONTEND_MOCKS_DIR / f"match_{DEFAULT_MATCH_ID}_narration.json"
        hint = f"{path.name} is stale: run `python -m app.services.synthetic_generator --write` from backend/"
        strip = lambda text: "".join(ch for ch in text if not ch.isdigit())  # libm differs across OSes
        committed = json.loads(path.read_text(encoding="utf-8"))
        generated = json.loads(_dump_narration(generate_match(DEFAULT_MATCH_ID)))
        self.assertEqual(set(committed), set(generated), hint)
        for uuid_, by_lang in generated.items():
            for lang, by_audience in by_lang.items():
                for audience, entry in by_audience.items():
                    got = committed[uuid_][lang][audience]
                    self.assertEqual(got["moment_label"], entry["moment_label"], hint)
                    for c, g in zip(got["agent_debate"], entry["agent_debate"]):
                        self.assertEqual(strip(c["headline"] + c["analysis_body"]),
                                         strip(g["headline"] + g["analysis_body"]), hint)


class NarrationApiTest(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.client = TestClient(app)

    def test_frames_endpoint_honours_profile(self):
        res = self.client.get(f"/api/v1/match/{DEFAULT_MATCH_ID}/frames", params={"lang": "es", "audience": "casual"})
        self.assertEqual(res.status_code, 200)
        frame = res.json()[0]
        self.assertEqual(frame["moment_label"], MOMENT_LABELS[frame["moment_key"]]["es"])
        self.assertIn("Peligro de gol", frame["agent_debate"][0]["referenced_metric"])

        default = self.client.get(f"/api/v1/match/{DEFAULT_MATCH_ID}/frames").json()[0]
        self.assertEqual(default["moment_label"], MOMENT_LABELS[default["moment_key"]]["en"])

    def test_unknown_profile_is_rejected(self):
        self.assertEqual(self.client.get(f"/api/v1/match/{DEFAULT_MATCH_ID}/frames", params={"lang": "fr"}).status_code, 422)
        self.assertEqual(
            self.client.get(f"/api/v1/match/{DEFAULT_MATCH_ID}/frames", params={"audience": "vip"}).status_code, 422
        )

    def test_simulate_speaks_the_requested_language(self):
        frame = _frames()[1]
        body = {
            "match_id": DEFAULT_MATCH_ID,
            "event_uuid": frame.event_uuid,
            "modified_players": [_moved(frame, 4.0).model_dump()],
            "language": "es",
            "audience": "coach",
        }
        res = self.client.post("/api/v1/simulate", json=body)
        self.assertEqual(res.status_code, 200)
        debate = res.json()["agent_debate"]
        self.assertTrue(debate[0]["timestamp_label"].endswith("[SIMULACIÓN]"))
        self.assertEqual(debate[1]["agent_name"], AGENT_NAMES["es"][AgentRole.CLASSIC_COACH])

    def test_simulate_rejects_empty_move_list(self):
        frame = _frames()[0]
        res = self.client.post("/api/v1/simulate", json={
            "match_id": DEFAULT_MATCH_ID, "event_uuid": frame.event_uuid, "modified_players": [],
        })
        self.assertEqual(res.status_code, 422)

    def test_websocket_uses_query_profile(self):
        with self.client.websocket_connect(f"/ws/match/{DEFAULT_MATCH_ID}?lang=es&audience=audio_description") as ws:
            first = ws.receive_json()
            payload = first["payload"]
            self.assertEqual(payload["moment_label"], MOMENT_LABELS[payload["moment_key"]]["es"])
            self.assertIn("Peligro de gol", payload["agent_debate"][0]["referenced_metric"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
