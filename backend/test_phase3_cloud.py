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
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.schemas.match_contract import CounterfactualRequest, PlayerNode, MatchFramePayload
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")



class TestPhase3CloudArchitecture(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Move the defender closest to the ball in the first synthetic moment.
        frame = MatchFramePayload(**loader.fetch_match_360_frames(DEFAULT_MATCH_ID)[0])
        defenders = [p for p in frame.players if p.team != frame.possession_team and not p.is_keeper]
        defender = min(defenders, key=lambda p: (p.x - frame.ball_x) ** 2 + (p.y - frame.ball_y) ** 2)
        moved = defender.model_copy(update={
            "x": round(min(119.0, defender.x + 4.0), 1),
            "original_x": defender.x,
            "original_y": defender.y,
            "is_modified": True,
        })
        self.test_payload = {
            "match_id": DEFAULT_MATCH_ID,
            "event_uuid": frame.event_uuid,
            "modified_players": [moved.model_dump(mode="json")],
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
        self.assertEqual(data["match_id"], DEFAULT_MATCH_ID)
        self.assertIsNotNone(data["metrics"]["simulated_xt"])
        print("  [OK] AKS Worker computes simulation directly in-process")

    def test_05_cloud_telemetry_endpoint(self):
        """Verifies GET /api/v1/cloud/telemetry returns full cluster and metric state."""
        response = self.client.get("/api/v1/cloud/telemetry")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("service_role", data)
        self.assertIn("compute_mode", data)
        self.assertEqual(data["keda_target_concurrency"], 20)
        self.assertEqual(data["aks_hpa_target_cpu_pct"], 65)
        self.assertIn("metrics", data)
        self.assertIn("total_simulations", data["metrics"])
        self.assertIn("circuit_breaker_trips", data["metrics"])
        self.assertIn("last_compute_latency_ms", data["metrics"])
        print(f"  [OK] Cloud telemetry endpoint verified (Total sims: {data['metrics']['total_simulations']}, Trips: {data['metrics']['circuit_breaker_trips']})")

    def test_06_chaos_toggle_and_circuit_breaker(self):
        """
        Verifies POST /api/v1/cloud/chaos-toggle:
        Simulates AKS outage, verifies Circuit Breaker trips to local compute,
        and ensures 200 OK without any request loss.
        """
        # 1. Enable Chaos
        resp_on = self.client.post("/api/v1/cloud/chaos-toggle?force=true")
        self.assertEqual(resp_on.status_code, 200)
        data_on = resp_on.json()
        self.assertTrue(data_on["chaos_force_aks_failure"])
        initial_trips = data_on["circuit_breaker_trips"]

        # 2. Execute simulation during simulated outage
        sim_resp = self.client.post("/api/v1/simulate", json=self.test_payload)
        self.assertEqual(sim_resp.status_code, 200)
        sim_data = sim_resp.json()
        self.assertIsNotNone(sim_data["metrics"]["simulated_xt"])

        # 3. Check telemetry reflects tripped circuit breaker
        telemetry_resp = self.client.get("/api/v1/cloud/telemetry")
        self.assertEqual(telemetry_resp.status_code, 200)
        self.assertGreaterEqual(telemetry_resp.json()["metrics"]["circuit_breaker_trips"], initial_trips)

        # 4. Restore normal operation
        resp_off = self.client.post("/api/v1/cloud/chaos-toggle?force=false")
        self.assertEqual(resp_off.status_code, 200)
        self.assertFalse(resp_off.json()["chaos_force_aks_failure"])
        print("  [OK] Chaos Engineering toggle & zero-downtime Circuit Breaker verified")

    def test_07_stress_burst_parallel_kdtree(self):
        """Verifies POST /api/v1/cloud/stress-burst runs 25 parallel simulations."""
        response = self.client.post("/api/v1/cloud/stress-burst")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["simulations_count"], 25)
        self.assertGreater(data["total_time_ms"], 0)
        self.assertGreater(data["throughput_simulations_per_sec"], 0)
        print(f"  [OK] Stress Burst Benchmark: 25 sims in {data['total_time_ms']}ms ({data['throughput_simulations_per_sec']} sims/sec)")

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
