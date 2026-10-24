"""
Test Suite for Persona 2 — Multi-Agent Swarm, Deterministic Verifier, MCP Server & Natural-Language What-If.

Covers:
1. Real multi-agent dialectical workflow (`backend/app/agents/orchestrator.py` & `agent_swarm.py`):
   - Coach Bianchi proposes a tactical adjustment within the 6.0m inertia ring.
   - Dr. Voronoi validates by calling engine tools (`simulate_counterfactual`, `optimizer/solve`, `xt_at`).
   - Both agents contrast numbers and deliver a verdict while keeping the `AgentMessage` contract.
   - Supports LLM tool-calling turns (`tool_calls`) as well as deterministic tool-backed execution.
2. Model Context Protocol (MCP) server (`backend/app/mcp/server.py`):
   - Exposes `simulate_counterfactual`, `optimizer/solve`, `xt_at`, and `what_if_natural_language`
     via JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`) and REST.
3. Deterministic numerical verifier (`backend/app/agents/verifier.py`):
   - Verifies every number in the LLM output against ground-truth metrics.
   - Auto-repairs contextual numeric mismatches in-place.
   - Falls back to the deterministic template when unrepairable hallucinated numbers appear.
4. Natural-language What-If (`backend/app/agents/what_if_nl.py`):
   - Evaluates queries like `"¿y si el lateral cierra por dentro?"` using the same engine tools.
"""

import sys
import json
import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

from app.core import rate_limit
from app.main import app
from app.schemas.match_contract import AgentMessage, AgentRole, MatchFramePayload
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.services.tactical_math import get_xt_at_point, simulate_counterfactual
from app.services.agent_swarm import swarm, _simulation_cache, _simulation_report_cache
from app.agents import (
    DialecticalAgentOrchestrator,
    EngineToolRegistry,
    WhatIfNLRequest,
    collect_ground_truth_numbers,
    extract_unverified_numbers,
    propose_coach_adjustment,
    verify_and_repair_debate,
)
from app.mcp import mcp_server


def _sample_simulated_frame() -> MatchFramePayload:
    frames = loader.fetch_match_360_frames(DEFAULT_MATCH_ID)
    base = MatchFramePayload(**frames[1])
    defenders = [p for p in base.players if p.team != base.possession_team and not p.is_keeper]
    defender = min(defenders, key=lambda p: (p.x - base.ball_x) ** 2 + (p.y - base.ball_y) ** 2)
    moved = defender.model_copy(
        update={
            "x": round(min(119.0, defender.x + 3.5), 1),
            "y": round(defender.y, 1),
            "original_x": defender.x,
            "original_y": defender.y,
            "is_modified": True,
        }
    )
    return simulate_counterfactual(base, [moved])


class MultiAgentDialecticalSwarmTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _simulation_cache.clear()
        _simulation_report_cache.clear()
        rate_limit.reset()

    async def test_bianchi_proposes_and_voronoi_validates_with_tools(self):
        """Bianchi proposes a <=6m adjustment; Voronoi calls simulate_counterfactual, optimizer/solve, and xt_at."""
        sim_frame = _sample_simulated_frame()
        debate = await swarm.generate_debate(sim_frame, language="es", audience="analyst")

        # Contract check: 2 messages [DATA_SCIENTIST, CLASSIC_COACH]
        self.assertEqual(len(debate), 2)
        self.assertEqual([m.agent_role for m in debate], [AgentRole.DATA_SCIENTIST, AgentRole.CLASSIC_COACH])

        report = swarm.last_report
        self.assertIsNotNone(report)

        # 1. Bianchi proposal check
        proposal = report.bianchi_proposal
        self.assertLessEqual(proposal.displacement_m, 6.0)
        self.assertGreater(proposal.displacement_m, 0.0)

        # 2. Voronoi tool validation check (all 3 tools executed)
        called_tools = {tc.tool_name for tc in report.tool_calls}
        self.assertIn("xt_at", called_tools)
        self.assertIn("simulate_counterfactual", called_tools)
        self.assertIn("optimizer/solve", called_tools)

        # 3. Disagreement with numbers & Verdict check
        self.assertIsNotNone(report.verdict)
        self.assertIn(report.verdict.verdict_code, ("adjustment_approved", "optimizer_preferred", "revert_move"))
        self.assertIn("Veredicto", debate[0].analysis_body)
        self.assertIn("Veredicto", debate[1].analysis_body)

        # 4. Deterministic verification passed with zero unverified numbers
        self.assertIsNotNone(report.verification)
        truth = collect_ground_truth_numbers(sim_frame, report.tool_calls, proposal)
        for msg in debate:
            for field_text in (msg.headline, msg.analysis_body, msg.referenced_metric):
                self.assertEqual(extract_unverified_numbers(field_text, truth), [])

    async def test_llm_multi_turn_tool_calling_and_verification(self):
        """Tests LLM agent loop when Azure OpenAI requests tool calls and returns JSON debate."""
        sim_frame = _sample_simulated_frame()
        m = sim_frame.metrics

        # First LLM response requests tool calls (`xt_at`, `simulate_counterfactual`, `optimizer_solve`)
        tc1 = MagicMock()
        tc1.id = "call_xt_1"
        tc1.function.name = "xt_at"
        tc1.function.arguments = json.dumps({"x": 95.0, "y": 40.0, "language": "es"})

        tc2 = MagicMock()
        tc2.id = "call_opt_2"
        tc2.function.name = "optimizer_solve"
        tc2.function.arguments = json.dumps({"max_defenders_to_move": 2, "max_radius_meters": 5.8})

        first_msg = MagicMock()
        first_msg.content = None
        first_msg.tool_calls = [tc1, tc2]
        first_resp = MagicMock()
        first_resp.choices = [MagicMock(message=first_msg)]

        # Second LLM response after receiving tool results returns the structured debate
        second_payload = {
            "debate": [
                {
                    "message_id": "msg-llm-01",
                    "agent_role": "data_scientist",
                    "agent_name": "Dr. Voronoi (Científico de datos)",
                    "avatar_badge": "AI-QUANT",
                    "timestamp_label": f"{sim_frame.minute}:{sim_frame.second:02d} [SIMULACIÓN]",
                    "headline": f"Amenaza ajustada a {m.simulated_xt:.2f} xT (ΔxT: {m.xt_delta:+.2f})",
                    "analysis_body": (
                        f"El xT pasa de {m.original_xt:.2f} a {m.simulated_xt:.2f} con probabilidad de pase del "
                        f"{m.pass_completion_prob:.1f}% y control de Voronoi del {m.space_control_home_pct:.1f}%."
                    ),
                    "referenced_metric": f"ΔxT: {m.xt_delta:+.2f} | Prob. pase: {m.pass_completion_prob:.1f}%",
                    "highlighted_player_ids": [sim_frame.players[0].player_id],
                },
                {
                    "message_id": "msg-llm-02",
                    "agent_role": "classic_coach",
                    "agent_name": "Míster Bianchi (Entrenador clásico)",
                    "avatar_badge": "PRO-COACH",
                    "timestamp_label": f"{sim_frame.minute}:{sim_frame.second:02d} [SIMULACIÓN]",
                    "headline": "Cierre de carril interior y ajuste de marca",
                    "analysis_body": (
                        f"Con probabilidad de pase del {m.pass_completion_prob:.1f}%, hay que bascular 3 m "
                        "hacia dentro antes de que el receptor gire."
                    ),
                    "referenced_metric": f"Prob. pase: {m.pass_completion_prob:.1f}%",
                    "highlighted_player_ids": [sim_frame.players[1].player_id],
                },
            ]
        }
        second_msg = MagicMock()
        second_msg.content = json.dumps(second_payload)
        second_msg.tool_calls = None
        second_resp = MagicMock()
        second_resp.choices = [MagicMock(message=second_msg)]

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=[first_resp, second_resp])

        orch = DialecticalAgentOrchestrator(client=mock_client)
        report = await orch.run_debate(sim_frame, language="es", audience="analyst", client=mock_client)

        self.assertTrue(report.used_llm)
        self.assertEqual(mock_client.chat.completions.create.call_count, 2)
        self.assertTrue(report.verification.all_matched_initially)
        self.assertFalse(report.verification.fell_back_to_template)
        self.assertEqual(report.messages[0].message_id, "msg-llm-01")


class DeterministicVerifierTest(unittest.TestCase):
    def test_verifier_repairs_contextual_metric_mismatches(self):
        """When the LLM outputs wrong numbers in labeled metric slots, the verifier repairs them in-place."""
        sim_frame = _sample_simulated_frame()
        m = sim_frame.metrics

        wrong_llm_messages = [
            AgentMessage(
                message_id="msg-bad-1",
                agent_role=AgentRole.DATA_SCIENTIST,
                agent_name="Dr. Voronoi (Científico de datos)",
                avatar_badge="AI-QUANT",
                timestamp_label="12:00 [SIMULACIÓN]",
                headline="Ajuste táctico evaluado (ΔxT: -0.99)",
                analysis_body=(
                    "El xT cae de 0.88 a 0.77 y la probabilidad de pase baja al 99.9% "
                    "con un control territorial de Voronoi del 88.8%."
                ),
                referenced_metric="ΔxT: -0.99 | Prob. pase: 99.9%",
                highlighted_player_ids=[sim_frame.players[0].player_id],
            ),
            AgentMessage(
                message_id="msg-bad-2",
                agent_role=AgentRole.CLASSIC_COACH,
                agent_name="Míster Bianchi (Entrenador clásico)",
                avatar_badge="PRO-COACH",
                timestamp_label="12:00 [SIMULACIÓN]",
                headline="Vigilar el carril interior",
                analysis_body="El bloque mantiene la distancia de presión a menos de 2 m del receptor.",
                referenced_metric="Distancia < 2 m",
                highlighted_player_ids=[sim_frame.players[1].player_id],
            ),
        ]

        report = verify_and_repair_debate(wrong_llm_messages, sim_frame, language="es", audience="analyst")
        self.assertFalse(report.all_matched_initially)
        self.assertTrue(report.corrected_in_place)
        self.assertFalse(report.fell_back_to_template)

        ds_msg = report.messages[0]
        self.assertIn(f"{m.original_xt:.2f}", ds_msg.analysis_body)
        self.assertIn(f"{m.simulated_xt:.2f}", ds_msg.analysis_body)
        self.assertIn(f"{m.pass_completion_prob:.1f}%", ds_msg.analysis_body)
        self.assertIn(f"{m.space_control_home_pct:.1f}%", ds_msg.analysis_body)
        self.assertIn(f"{m.xt_delta:+.2f}", ds_msg.referenced_metric)

    def test_verifier_falls_back_to_template_on_hallucinated_numbers(self):
        """When the LLM invents arbitrary uncontextualized statistics, the verifier falls back to template."""
        sim_frame = _sample_simulated_frame()
        hallucinated = [
            AgentMessage(
                message_id="msg-hal-1",
                agent_role=AgentRole.DATA_SCIENTIST,
                agent_name="Dr. Voronoi",
                avatar_badge="AI-QUANT",
                timestamp_label="12:00 [SIMULACIÓN]",
                headline="Dato inventado 742 en 1994",
                analysis_body="En los últimos 83 partidos hubo 419 pases con índice 17.43.",
                referenced_metric="Índice: 419.7",
                highlighted_player_ids=[9999],
            ),
            AgentMessage(
                message_id="msg-hal-2",
                agent_role=AgentRole.CLASSIC_COACH,
                agent_name="Míster Bianchi",
                avatar_badge="PRO-COACH",
                timestamp_label="12:00 [SIMULACIÓN]",
                headline="En 1986 ganamos 54 balones",
                analysis_body="Hicimos 312 kilómetros en 97 minutos.",
                referenced_metric="312 km",
                highlighted_player_ids=[8888],
            ),
        ]

        report = verify_and_repair_debate(hallucinated, sim_frame, language="es", audience="analyst")
        self.assertFalse(report.all_matched_initially)
        self.assertTrue(report.fell_back_to_template)

        truth = collect_ground_truth_numbers(sim_frame)
        for msg in report.messages:
            self.assertNotIn("419", msg.analysis_body)
            self.assertNotIn("312", msg.analysis_body)
            self.assertEqual(extract_unverified_numbers(msg.analysis_body, truth), [])


class MCPServerAndWhatIfTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        rate_limit.reset()
        self.client = TestClient(app)

    async def test_mcp_jsonrpc_protocol_and_tools(self):
        """MCP server exposes simulate_counterfactual, optimizer/solve, and xt_at via JSON-RPC 2.0."""
        # 1. initialize
        init_res = await mcp_server.handle_jsonrpc({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        self.assertEqual(init_res["result"]["serverInfo"]["name"], "xt-whatif-mcp-server")

        # 2. tools/list
        list_res = await mcp_server.handle_jsonrpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tool_names = {t["name"] for t in list_res["result"]["tools"]}
        self.assertIn("simulate_counterfactual", tool_names)
        self.assertIn("optimizer/solve", tool_names)
        self.assertIn("xt_at", tool_names)
        self.assertIn("what_if_natural_language", tool_names)

        # 3. tools/call -> xt_at
        xt_res = await mcp_server.handle_jsonrpc({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "xt_at", "arguments": {"x": 105.0, "y": 40.0, "language": "es"}},
        })
        self.assertFalse(xt_res["result"]["isError"])
        xt_data = xt_res["result"]["structuredContent"]
        self.assertAlmostEqual(xt_data["xt"], get_xt_at_point(105.0, 40.0), places=4)

        # 4. tools/call -> optimizer/solve
        opt_res = await mcp_server.handle_jsonrpc({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "optimizer/solve", "arguments": {"max_defenders_to_move": 1}},
        })
        self.assertFalse(opt_res["result"]["isError"])
        opt_data = opt_res["result"]["structuredContent"]
        self.assertIn("projected_metrics", opt_data)
        self.assertGreater(opt_data["evaluated_configurations"], 0)

        # 5. tools/call -> simulate_counterfactual
        frames = loader.fetch_match_360_frames(DEFAULT_MATCH_ID)
        f0 = frames[0]
        p0 = f0["players"][0]
        sim_res = await mcp_server.handle_jsonrpc({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "simulate_counterfactual",
                "arguments": {
                    "event_uuid": f0["event_uuid"],
                    "modified_players": [{"player_id": p0["player_id"], "x": p0["x"] + 2.0, "y": p0["y"]}],
                },
            },
        })
        self.assertFalse(sim_res["result"]["isError"])
        sim_data = sim_res["result"]["structuredContent"]
        self.assertEqual(sim_data["event_uuid"], f0["event_uuid"])
        self.assertIn("simulated_xt", sim_data)

    def test_http_mcp_and_natural_language_what_if_endpoints(self):
        """Tests HTTP endpoints for MCP (`/api/v1/mcp/tools`) and NL What-If (`/api/v1/agents/what-if`)."""
        # MCP tools over HTTP
        res_tools = self.client.get("/api/v1/mcp/tools")
        self.assertEqual(res_tools.status_code, 200)
        names = {t["name"] for t in res_tools.json()["tools"]}
        self.assertTrue({"simulate_counterfactual", "optimizer/solve", "xt_at"}.issubset(names))

        # MCP JSON-RPC over HTTP
        res_rpc = self.client.post(
            "/api/v1/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 10,
                "method": "tools/call",
                "params": {"name": "xt_at", "arguments": {"x": 110.0, "y": 40.0}},
            },
        )
        self.assertEqual(res_rpc.status_code, 200)
        self.assertFalse(res_rpc.json()["result"]["isError"])

        # Natural-Language What-If ("¿y si el lateral cierra por dentro?")
        res_nl = self.client.post(
            "/api/v1/agents/what-if",
            json={
                "query": "¿y si el lateral cierra por dentro?",
                "match_id": DEFAULT_MATCH_ID,
                "language": "es",
                "audience": "analyst",
            },
        )
        self.assertEqual(res_nl.status_code, 200)
        nl_data = res_nl.json()
        self.assertEqual(nl_data["query"], "¿y si el lateral cierra por dentro?")
        self.assertEqual(nl_data["interpreted_move"]["tactical_role"], "Lateral")
        self.assertLessEqual(nl_data["interpreted_move"]["displacement_m"], 6.0)
        self.assertTrue(nl_data["simulated_frame"]["is_counterfactual_mode"])
        self.assertEqual(len(nl_data["simulated_frame"]["agent_debate"]), 2)
        called_in_nl = {t["tool_name"] for t in nl_data["tool_calls"]}
        self.assertEqual(called_in_nl, {"xt_at", "simulate_counterfactual", "optimizer/solve"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
