"""
Tests for the public-demo guardrails: rate limiting, input bounds, chaos auto-reset,
WebSocket limits and CORS.

Run: python backend/test_hardening.py   (PYTHONPATH=./backend)
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

import app.main as main_module
from app.core import rate_limit
from app.core.config import settings
from app.main import app, cloud_metrics_store
from app.schemas.match_contract import MatchFramePayload
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID


def _payload():
    frame = MatchFramePayload(**loader.fetch_match_360_frames(DEFAULT_MATCH_ID)[0])
    defender = next(p for p in frame.players if p.team != frame.possession_team and not p.is_keeper)
    moved = defender.model_copy(update={"x": round(min(119.0, defender.x + 3.0), 1), "is_modified": True,
                                        "original_x": defender.x, "original_y": defender.y})
    return frame, {"match_id": DEFAULT_MATCH_ID, "event_uuid": frame.event_uuid,
                   "modified_players": [moved.model_dump(mode="json")]}


class TestHardening(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        settings.RATE_LIMIT_ENABLED = True
        settings.SERVICE_ROLE = "standalone"
        settings.AKS_WORKER_URL = None
        cloud_metrics_store["chaos_force_aks_failure"] = False
        main_module._chaos_enabled_at = None
        self.client = TestClient(app)

    def tearDown(self):
        rate_limit.reset()
        cloud_metrics_store["chaos_force_aks_failure"] = False
        main_module._chaos_enabled_at = None

    def test_rate_limit_returns_429_with_retry_after(self):
        limit = rate_limit.ROUTE_LIMITS["/api/v1/cloud/stress-burst"]
        for _ in range(limit):
            self.assertEqual(self.client.post("/api/v1/cloud/stress-burst").status_code, 200)
        res = self.client.post("/api/v1/cloud/stress-burst")
        self.assertEqual(res.status_code, 429)
        self.assertGreaterEqual(int(res.headers["Retry-After"]), 1)

    def test_rate_limit_is_per_client(self):
        bucket = "/api/v1/cloud/stress-burst"
        limit = rate_limit.ROUTE_LIMITS[bucket]
        for _ in range(limit):
            self.assertTrue(rate_limit.allow(bucket, "10.0.0.1", now=0.0)[0])
        self.assertFalse(rate_limit.allow(bucket, "10.0.0.1", now=1.0)[0])
        self.assertTrue(rate_limit.allow(bucket, "10.0.0.2", now=1.0)[0])
        # The window slides.
        self.assertTrue(rate_limit.allow(bucket, "10.0.0.1", now=61.0)[0])

    def test_client_key_uses_proxy_appended_address(self):
        headers = {"x-forwarded-for": "6.6.6.6, 203.0.113.9"}
        self.assertEqual(rate_limit.client_key(headers, "10.1.1.1"), "203.0.113.9")
        self.assertEqual(rate_limit.client_key({}, "10.1.1.1"), "10.1.1.1")

    def test_get_routes_are_not_limited(self):
        for _ in range(100):
            self.assertEqual(self.client.get("/health").status_code, 200)

    def test_input_bounds(self):
        frame, payload = _payload()
        too_many = dict(payload, modified_players=payload["modified_players"] * 23)
        self.assertEqual(self.client.post("/api/v1/simulate", json=too_many).status_code, 422)
        long_text = {"text": "x" * 5000, "agent_role": "data_scientist"}
        self.assertEqual(self.client.post("/api/v1/tts/synthesize", json=long_text).status_code, 422)

    def test_chaos_mode_resets_itself(self):
        res = self.client.post("/api/v1/cloud/chaos-toggle", params={"force": "true"})
        self.assertTrue(res.json()["chaos_force_aks_failure"])
        self.assertIsNotNone(res.json()["chaos_auto_reset_in_s"])
        # Pretend the reset window has elapsed.
        main_module._chaos_enabled_at -= settings.CHAOS_AUTO_RESET_SECONDS + 1
        telemetry = self.client.get("/api/v1/cloud/telemetry").json()
        self.assertFalse(telemetry["chaos_force_aks_failure"])
        self.assertIsNone(telemetry["chaos_auto_reset_in_s"])

    def test_websocket_rejects_oversized_and_invalid_messages(self):
        frame, payload = _payload()
        with self.client.websocket_connect(f"/ws/match/{DEFAULT_MATCH_ID}") as ws:
            self.assertEqual(ws.receive_json()["type"], "INITIAL_FRAME")
            ws.send_json({"type": "SIMULATE_MOVE", "payload": {"match_id": DEFAULT_MATCH_ID}})
            self.assertEqual(ws.receive_json(), {"type": "SIMULATION_ERROR", "reason": "invalid_payload"})
            ws.send_json({"type": "SIMULATE_MOVE", "payload": payload})
            self.assertEqual(ws.receive_json()["type"], "SIMULATION_UPDATE")
            ws.send_text("x" * (settings.WS_MAX_MESSAGE_BYTES + 1))
            with self.assertRaises(Exception):
                ws.receive_json()

    def test_websocket_simulations_share_the_rate_limit(self):
        frame, payload = _payload()
        bucket = rate_limit.WS_SIMULATE_BUCKET
        for _ in range(rate_limit.ROUTE_LIMITS[bucket]):
            rate_limit.allow(bucket, "testclient")
        with self.client.websocket_connect(f"/ws/match/{DEFAULT_MATCH_ID}") as ws:
            ws.receive_json()
            ws.send_json({"type": "SIMULATE_MOVE", "payload": payload})
            msg = ws.receive_json()
            self.assertEqual(msg["type"], "SIMULATION_ERROR")
            self.assertEqual(msg["reason"], "rate_limited")

    def test_cors_never_combines_wildcard_with_credentials(self):
        res = self.client.options(
            "/api/v1/simulate",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
        )
        if "*" in (settings.CORS_ORIGINS or ["*"]):
            self.assertNotEqual(res.headers.get("access-control-allow-credentials"), "true")
        else:
            self.assertEqual(res.headers.get("access-control-allow-origin"), "http://localhost:3000")


if __name__ == "__main__":
    unittest.main(verbosity=2)
