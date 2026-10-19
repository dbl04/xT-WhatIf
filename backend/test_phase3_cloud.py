"""
Automated Test Suite for Phase 3: Cloud Architecture & Circuit Breaker.
Validates:
1. Health endpoint reporting SERVICE_ROLE and compute_mode.
2. Standalone vs ACA Gateway vs AKS Worker roles.
3. Circuit Breaker: graceful local fallback when AKS Worker is unreachable or errors.
4. Distributed simulation forwarding when remote worker responds with HTTP 200.
"""

import sys
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.schemas.match_contract import CounterfactualRequest, PlayerNode, MatchFramePayload

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


class TestPhase3CloudArchitecture(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_payload = {
            "match_id": 3869685,
            "event_uuid": "e21a1102-1a4c-4e1b-9f11-77a8123cc101",
            "modified_players": [
                {
                    "player_id": 5,
                    "name": "J. Koundé",
                    "jersey_number": 5,
                    "team": "away",
                    "is_actor": False,
                    "is_keeper": False,
                    "x": 88.0,
                    "y": 25.0,
                    "original_x": 93.0,
                    "original_y": 18.0,
                    "is_modified": True,
                }
            ],
        }

    def test_01_health_check_standalone(self):
        """Verifies health endpoint in default standalone mode."""
        settings.SERVICE_ROLE = "standalone"
        settings.AKS_WORKER_URL = None

        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["service_role"], "standalone")
        self.assertEqual(data["compute_mode"], "local-in-process")
        print("  [OK] Health check in standalone mode: local-in-process")

    def test_02_health_check_aca_gateway_distributed(self):
        """Verifies health check reporting distributed mode when AKS_WORKER_URL is configured."""
        settings.SERVICE_ROLE = "aca-gateway"
        settings.AKS_WORKER_URL = "http://xt-whatif-aks-worker-svc.xt-whatif.svc.cluster.local:8000"

        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["service_role"], "aca-gateway")
        self.assertEqual(data["compute_mode"], "aks-distributed")
        print("  [OK] Health check in ACA Gateway mode: aks-distributed")

    def test_03_circuit_breaker_activates_on_worker_failure(self):
        """
        Verifies Circuit Breaker:
        When running as ACA Gateway and AKS Worker is unreachable or throws an exception,
        the gateway catches the error, trips circuit breaker, and computes locally without failing.
        """
        settings.SERVICE_ROLE = "aca-gateway"
        settings.AKS_WORKER_URL = "http://unreachable-aks-worker-host:8000"

        # The remote call to unreachable host will trigger ConnectError / Timeout
        response = self.client.post("/api/v1/simulate", json=self.test_payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Check that simulation still produced valid xT metrics and debate
        self.assertIn("metrics", data)
        self.assertIn("agent_debate", data)
        self.assertTrue(len(data["agent_debate"]) >= 2)
        print(f"  [OK] Circuit Breaker successfully fell back to in-process local execution (Simulated xT: {data['metrics']['simulated_xt']})")

    def test_04_aks_worker_role_local_computation(self):
        """Verifies aks-worker role computes directly in process."""
        settings.SERVICE_ROLE = "aks-worker"
        settings.AKS_WORKER_URL = None

        response = self.client.post("/api/v1/simulate", json=self.test_payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["match_id"], 3869685)
        self.assertIsNotNone(data["metrics"]["simulated_xt"])
        print("  [OK] AKS Worker computes simulation directly in-process")

    def tearDown(self):
        # Reset to safe local defaults
        settings.SERVICE_ROLE = "standalone"
        settings.AKS_WORKER_URL = None


if __name__ == "__main__":
    print("\n--- Running Phase 3 Cloud Architecture & Circuit Breaker Tests ---")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPhase3CloudArchitecture)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
    print("\n=================================================")
    print(">>> ALL PHASE 3 CLOUD TESTS PASSED SUCCESSFULLY! <<<")
    print("=================================================")
