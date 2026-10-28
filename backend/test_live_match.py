"""
Tests for the live game: full synthetic match, match room (moment cycle, submissions,
scoring, leaderboard), bots and the /ws/live socket. Time is passed in, nothing sleeps.

Run: python backend/test_live_match.py   (PYTHONPATH=./backend)
"""

import asyncio
import random
import sys
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient

from app.schemas.live import MoveIn, Profile, SubmitIn
from app.schemas.match_contract import TeamSide
from app.services import live_match
from app.services.full_match import MATCH_SECONDS, generate_full_match
from app.services.game_engine import MAX_SCORE, analyse_moment, validate_moves
from app.services.live_match import MatchRoom, bot_moves, make_bots
from app.services.narration import MOMENT_LABELS

SEED = 12
EVENTS = generate_full_match(SEED)
T0 = 1_000_000.0


def _first_open(events, start=0):
    for e in events[start:]:
        if e.candidate:
            report = analyse_moment(e.frame)
            if report.opens:
                return e, report
    raise AssertionError("no openable moment")


def _fan(uid, team, lang="en"):
    return Profile(user_id=uid, nickname=uid, team=team, language=lang)


class FullMatchTest(unittest.TestCase):
    def test_deterministic_and_chronological(self):
        again = generate_full_match(SEED)
        self.assertEqual([e.frame.event_uuid for e in again], [e.frame.event_uuid for e in EVENTS])
        times = [e.match_seconds for e in EVENTS]
        self.assertEqual(times, sorted(times))
        self.assertTrue(0 < times[0] and times[-1] < MATCH_SECONDS)

    def test_frames_scores_and_labels(self):
        home = away = 0
        for e in EVENTS:
            self.assertEqual(len(e.frame.players), 22)
            self.assertIn(e.frame.moment_key, MOMENT_LABELS)
            self.assertTrue(MOMENT_LABELS[e.frame.moment_key]["es"])
            self.assertGreaterEqual(e.score.home, home)
            self.assertGreaterEqual(e.score.away, away)
            home, away = e.score.home, e.score.away
            if e.outcome == "goal":
                self.assertEqual(e.frame.event_type, "Shot")
        self.assertGreaterEqual(sum(e.candidate for e in EVENTS), 5)


class MatchRoomTest(unittest.TestCase):
    def setUp(self):
        self.room = MatchRoom(EVENTS, duration_s=300, window_s=30, cooldown_s=15)
        self.room.kickoff(T0)
        self.event, self.report = _first_open(EVENTS)
        self.at = self.room.real_time_of(self.event)

    def _open(self):
        self.room.due_events(self.at)
        self.assertTrue(self.room.can_open(self.event, self.at))
        return self.room.open_moment(self.event, self.report, self.at)

    def test_clock_maps_90_minutes_to_the_duration(self):
        self.assertEqual(self.room.due_events(T0 - 1), [])
        self.assertEqual(len(self.room.due_events(T0 + 300)), len(EVENTS))
        self.assertAlmostEqual(self.room.match_clock(T0 + 150), MATCH_SECONDS / 2)

    def test_one_moment_at_a_time(self):
        m = self._open()
        self.assertIsNotNone(m)
        later = next(e for e in EVENTS if e.candidate and e.index > self.event.index)
        self.assertFalse(self.room.can_open(later, self.at + 1))  # ignored while open
        self.room.close_moment(m.closes_at)
        self.assertFalse(self.room.can_open(later, m.closes_at + 1))  # cooldown
        self.assertTrue(self.room.can_open(later, m.closes_at + 16) or self.room.real_time_of(later) > T0 + 270)

    def test_submissions_scoring_and_leaderboard(self):
        m = self._open()
        opt_home = m.optimum(TeamSide.HOME)
        best = [MoveIn(player_id=p, x=x, y=y) for p, x, y in opt_home.moves]
        self.assertTrue(self.room.submit(_fan("ace", TeamSide.HOME), SubmitIn(moment_id=m.id, moves=best), self.at + 3)["accepted"])
        self.assertTrue(self.room.submit(_fan("idle", TeamSide.HOME), SubmitIn(moment_id=m.id, moves=[]), self.at + 4)["accepted"])

        locked = next(p for p in m.event.frame.players if p.is_keeper)
        bad = self.room.submit(_fan("cheat", TeamSide.AWAY),
                               SubmitIn(moment_id=m.id, moves=[MoveIn(player_id=locked.player_id, x=locked.x, y=locked.y + 1)]),
                               self.at + 5)
        self.assertFalse(bad["accepted"])
        self.assertEqual(bad["reason"], "rules")
        self.assertEqual(self.room.submit(_fan("ace", TeamSide.HOME), SubmitIn(moment_id="other", moves=[]), self.at + 6)["reason"], "closed")
        self.assertEqual(self.room.submit(_fan("slow", TeamSide.HOME), SubmitIn(moment_id=m.id, moves=[]), m.closes_at + 1)["reason"], "late")

        self.assertTrue(self.room.due_to_close(m.closes_at))
        self.room.close_moment(m.closes_at)
        self.assertEqual(m.submissions["ace"].score, MAX_SCORE)
        self.assertEqual(m.submissions["idle"].score, 0)
        board = self.room.leaderboard_for("idle")
        self.assertEqual(board["top"][0]["nickname"], "ace")
        self.assertEqual(board["you"], {"rank": 2, "total": 0})
        self.assertEqual(board["teams"]["home"]["fans"], 2)

    def test_server_enforces_the_hard_limits(self):
        """A client that ignores the board's clamp still cannot score an illegal move."""
        m = self._open()
        fan = _fan("hacker", TeamSide.HOME)
        movable = [p for p in m.event.frame.players if p.player_id in m.open_payload()["movable_player_ids"]["home"]]
        p = movable[0]
        far = self.room.submit(fan, SubmitIn(moment_id=m.id, moves=[MoveIn(player_id=p.player_id, x=p.x, y=p.y + 6.5 if p.y < 70 else p.y - 6.5)]), self.at + 1)
        self.assertFalse(far["accepted"])
        self.assertIn("too_far", {v["rule"] for v in far["violations"]})
        three = [MoveIn(player_id=q.player_id, x=q.x, y=q.y + (0.5 if q.y < 70 else -0.5)) for q in movable[:3]]
        many = self.room.submit(fan, SubmitIn(moment_id=m.id, moves=three), self.at + 2)
        self.assertFalse(many["accepted"])
        self.assertIn("too_many", {v["rule"] for v in many["violations"]})
        self.assertNotIn("hacker", m.submissions)

    def test_reveal_is_localised_and_personal(self):
        m = self._open()
        opt = m.optimum(TeamSide.AWAY)
        moves = [MoveIn(player_id=p, x=x, y=y) for p, x, y in opt.moves]
        self.room.submit(_fan("ana", TeamSide.AWAY, "es"), SubmitIn(moment_id=m.id, moves=moves), self.at + 2)
        self.room.close_moment(m.closes_at)
        es = self.room.reveal_for(m, _fan("ana", TeamSide.AWAY, "es"))
        self.assertEqual(es["your_score"], MAX_SCORE)
        self.assertIn("1000", es["explanation"]["personal"])
        self.assertIn("probabilidad de gol", es["explanation"]["body"])
        self.assertEqual(es["community"]["found_it_pct"], 100)
        en = self.room.reveal_for(m, _fan("bob", TeamSide.HOME))
        self.assertIsNone(en["your_score"])
        self.assertIn("did not submit", en["explanation"]["personal"])
        self.assertEqual(en["mode"], m.mode(TeamSide.HOME))

    def test_reveal_contrasts_user_move_vs_bot_move_between_voronoi_and_bianchi(self):
        m = self._open()
        opt = m.optimum(TeamSide.HOME)
        opt_ids = {pid for pid, _, _ in opt.moves}
        movable_ids = set(m.open_payload()["movable_player_ids"]["home"])
        other = next(p for p in m.event.frame.players if p.player_id in (movable_ids - opt_ids))
        bot_player = next(p for p in m.event.frame.players if p.player_id in opt_ids)
        dy = 2.5 if other.y < 60 else -2.5
        user_move = [MoveIn(player_id=other.player_id, x=other.x, y=other.y + dy)]
        fan = _fan("carlos", TeamSide.HOME, "es")
        ack = self.room.submit(fan, SubmitIn(moment_id=m.id, moves=user_move), self.at + 2)
        self.assertTrue(ack["accepted"])
        self.room.close_moment(m.closes_at)
        rev = self.room.reveal_for(m, fan)
        expl = rev["explanation"]
        self.assertTrue(expl.get("voronoi_comparison"))
        self.assertTrue(expl.get("bianchi_headline"))
        self.assertIn(other.name, expl["voronoi_comparison"])
        self.assertIn(bot_player.name, expl["voronoi_comparison"])
        self.assertIn(other.name, expl["personal"])
        self.assertIn(bot_player.name, expl["personal"])
        pundits = rev.get("pundits", [])
        self.assertEqual([p["agent_role"] for p in pundits], ["data_scientist", "classic_coach"])
        self.assertEqual(pundits[0]["avatar_badge"], "AI-QUANT")
        self.assertEqual(pundits[1]["avatar_badge"], "PRO-COACH")
        self.assertIn(expl["voronoi_comparison"], pundits[0]["analysis_body"])
        self.assertEqual(pundits[1]["analysis_body"], expl["personal"])

    def test_open_payload_tells_each_side_what_to_do(self):
        payload = self._open().open_payload()
        self.assertEqual({payload["modes"]["home"], payload["modes"]["away"]}, {"attack", "defend"})
        for team in ("home", "away"):
            self.assertTrue(payload["movable_player_ids"][team])
        self.assertEqual(payload["window_s"], 30)


class BotsTest(unittest.TestCase):
    def test_bots_play_legal_moves_and_skill_matters(self):
        room = MatchRoom(EVENTS, duration_s=300, window_s=30, cooldown_s=15)
        room.kickoff(T0)
        event, report = _first_open(EVENTS)
        at = room.real_time_of(event)
        room.due_events(at)
        m = room.open_moment(event, report, at)
        rng = random.Random(1)
        for team in (TeamSide.HOME, TeamSide.AWAY):
            for skill in (0.0, 0.5, 1.0):
                moves = bot_moves(m, team, skill, rng)
                self.assertEqual(validate_moves(m.event.frame, m.mode(team), [(mv.player_id, mv.x, mv.y) for mv in moves]), [])
        bots = make_bots(60, SEED)
        self.assertEqual(len({b.user_id for b, _ in bots}), 60)
        for i, (profile, skill) in enumerate(bots):
            room.submit(profile, SubmitIn(moment_id=m.id, moves=bot_moves(m, profile.team, skill, rng)), at + 1 + i * 0.1)
        room.close_moment(m.closes_at)
        scores = sorted(((skill, m.submissions[b.user_id].score) for b, skill in bots), key=lambda s: s[0])
        low = sum(s for _, s in scores[:20]) / 20
        high = sum(s for _, s in scores[-20:]) / 20
        self.assertGreater(high, low)


class RunnerTest(unittest.TestCase):
    def test_runner_plays_a_match_end_to_end(self):
        """Drives the real-time runner with a fake clock: events, a moment, bots, reveal and the final whistle."""
        runner = live_match.LiveMatchRunner()
        sent = []

        async def fake_broadcast(message):
            sent.append(message["type"])

        runner.broadcast = fake_broadcast
        live_match.settings.LIVE_BOTS = 30

        async def play():
            t = T0
            await runner._tick(t)
            while not runner.room.ended:
                t += 1.0
                await runner._tick(t)

        asyncio.run(play())
        self.assertIn("MATCH_EVENT", sent)
        self.assertIn("MOMENT_OPEN", sent)
        self.assertIn("MOMENT_CLOSED", sent)
        room = runner.room
        self.assertGreaterEqual(len(room.moments), 3)
        self.assertTrue(all(len(m.submissions) > 0 for m in room.moments))
        self.assertEqual(room.leaderboard_for(None)["players"], 30)


class RevealVoiceTest(unittest.TestCase):
    def test_voice_is_ready_at_close_and_secret_before(self):
        """Audio starts while the window is open, is served only after close, each text synthesised once."""
        runner = live_match.LiveMatchRunner()
        runner.room = MatchRoom(EVENTS, duration_s=300, window_s=30, cooldown_s=15)
        runner.room.kickoff(T0)
        event, report = _first_open(EVENTS)
        at = runner.room.real_time_of(event)
        fan = _fan("ana", TeamSide.AWAY, "es")
        runner.clients[object()] = fan
        runner.room.join(fan)
        calls = []

        async def fake_synthesize(request):
            calls.append(request.text)
            return live_match.TTSResponse(audio_base64=f"audio:{request.text}", provider="azure-openai-tts",
                                          voice_preset="test", estimated_duration_sec=1.0)

        async def scenario():
            runner.room.due_events(at)
            m = runner.room.open_moment(event, report, at)
            runner._prepare_voices(m, closed=False)
            self.assertIsNone(await runner.reveal_voice(m.id, fan.user_id))  # still secret
            runner.room.close_moment(m.closes_at)
            runner._prepare_voices(m, closed=True)
            lines = await runner.reveal_voice(m.id, fan.user_id)
            self.assertIsNone(await runner.reveal_voice(m.id, "stranger"))
            return m, lines

        with unittest.mock.patch.object(live_match, "azure_tts_configured", return_value=True), \
                unittest.mock.patch.object(live_match, "synthesize_speech", fake_synthesize):
            m, lines = asyncio.run(scenario())

        self.assertEqual([l["agent_role"] for l in lines], [live_match.REVEAL_SPEAKER.value])
        self.assertTrue(all(l["audio_base64"] == f"audio:{l['text']}" for l in lines))
        self.assertIn("Esta vez no enviaste", lines[0]["text"])
        self.assertEqual(len(calls), len(set(calls)))  # one synthesis per text
        self.assertIn(lines[0]["text"], calls[:1])  # the optimum started on open


class SocketTest(unittest.TestCase):
    def test_profile_is_required_and_state_is_sent(self):
        client = TestClient(live_match.router)
        with self.assertRaises(Exception):
            with client.websocket_connect("/ws/live?user_id=&nickname=x&team=home") as ws:
                ws.receive_json()
        with client.websocket_connect("/ws/live?user_id=u1&nickname=Ana&team=away&lang=es") as ws:
            first = ws.receive_json()
            self.assertEqual(first["type"], "MATCH_STATE")
            ws.send_json({"type": "SUBMIT", "payload": {"moment_id": "nope", "moves": []}})
            ack = ws.receive_json()
            self.assertEqual(ack["type"], "SUBMIT_ACK")
            self.assertFalse(ack["payload"]["accepted"])


class AksValidatorTest(unittest.TestCase):
    def setUp(self):
        from app.core.config import settings
        from app.services.cloud_telemetry import cloud_metrics_store

        self.settings = settings
        self.metrics = cloud_metrics_store
        self._orig_role = settings.SERVICE_ROLE
        self._orig_url = settings.AKS_WORKER_URL
        self._orig_token = settings.AKS_WORKER_TOKEN
        self._orig_chaos = cloud_metrics_store["chaos_force_aks_failure"]

    def tearDown(self):
        self.settings.SERVICE_ROLE = self._orig_role
        self.settings.AKS_WORKER_URL = self._orig_url
        self.settings.AKS_WORKER_TOKEN = self._orig_token
        self.metrics["chaos_force_aks_failure"] = self._orig_chaos

    def test_optimize_endpoint_rejects_gateway_and_bad_token(self):
        from app.main import app
        from app.services.game_engine import optimum_from_dict

        event, expected_report = _first_open(EVENTS)
        body = {"frame": event.frame.model_dump(mode="json"), "mode": "attack"}
        client = TestClient(app)

        # 1. 404 on aca-gateway and live roles
        self.settings.SERVICE_ROLE = "aca-gateway"
        self.settings.AKS_WORKER_TOKEN = "worker-secret"
        resp_gw = client.post("/api/v1/game/optimize", json=body, headers={"X-Worker-Token": "worker-secret"})
        self.assertEqual(resp_gw.status_code, 404)

        self.settings.SERVICE_ROLE = "live"
        resp_live = client.post("/api/v1/game/optimize", json=body, headers={"X-Worker-Token": "worker-secret"})
        self.assertEqual(resp_live.status_code, 404)

        # 2. 403 on aks-worker when AKS_WORKER_TOKEN is empty
        self.settings.SERVICE_ROLE = "aks-worker"
        self.settings.AKS_WORKER_TOKEN = ""
        resp_unset = client.post("/api/v1/game/optimize", json=body)
        self.assertEqual(resp_unset.status_code, 403)

        # 3. 401 when token is missing or wrong
        self.settings.AKS_WORKER_TOKEN = "worker-secret"
        resp_missing = client.post("/api/v1/game/optimize", json=body)
        self.assertEqual(resp_missing.status_code, 401)
        resp_wrong = client.post("/api/v1/game/optimize", json=body, headers={"X-Worker-Token": "wrong-token"})
        self.assertEqual(resp_wrong.status_code, 401)

        # 4. 200 with valid token on aks-worker
        resp_ok = client.post("/api/v1/game/optimize", json=body, headers={"X-Worker-Token": "worker-secret"})
        self.assertEqual(resp_ok.status_code, 200)
        restored = optimum_from_dict(resp_ok.json())
        self.assertEqual(restored.mode, "attack")
        self.assertEqual(restored.moves, expected_report.attack.moves)
        self.assertAlmostEqual(restored.best.value, expected_report.attack.best.value, places=9)

    def test_delegated_path_matches_local_analyse_moment(self):
        import json as _json
        import httpx
        from app.services.aks_client import analyse_moment_distributed
        from app.services.game_engine import optimize, optimum_to_dict

        event, local_report = _first_open(EVENTS)
        self.settings.SERVICE_ROLE = "live"
        self.settings.AKS_WORKER_URL = "http://aks-worker.local:8000"
        self.settings.AKS_WORKER_TOKEN = "test-secret-token"
        self.metrics["chaos_force_aks_failure"] = False

        seen_modes = []
        seen_tokens = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_tokens.append(request.headers.get("X-Worker-Token"))
            payload = _json.loads(request.content.decode("utf-8"))
            mode = payload["mode"]
            seen_modes.append(mode)
            opt = optimize(event.frame, mode)
            return httpx.Response(200, json=optimum_to_dict(opt))

        transport = httpx.MockTransport(handler)
        before_calls = self.metrics["aks_delegated_calls"]
        before_trips = self.metrics["circuit_breaker_trips"]

        dist_report = asyncio.run(analyse_moment_distributed(event.frame, transport=transport))

        self.assertEqual(sorted(seen_modes), ["attack", "defend"])
        self.assertEqual(seen_tokens, ["test-secret-token", "test-secret-token"])
        self.assertEqual(self.metrics["aks_delegated_calls"], before_calls + 1)
        self.assertEqual(self.metrics["circuit_breaker_trips"], before_trips)
        self.assertEqual(dist_report.event_uuid, local_report.event_uuid)
        self.assertEqual(dist_report.playable, local_report.playable)
        self.assertEqual(dist_report.opens, local_report.opens)
        self.assertEqual(dist_report.attack.moves, local_report.attack.moves)
        self.assertEqual(dist_report.defend.moves, local_report.defend.moves)
        self.assertAlmostEqual(dist_report.attack.best.value, local_report.attack.best.value, places=9)
        self.assertAlmostEqual(dist_report.defend.best.value, local_report.defend.best.value, places=9)

    def test_timeout_500_and_chaos_fallback_and_increment_circuit_breaker(self):
        import httpx
        from app.services.aks_client import analyse_moment_distributed

        event, local_report = _first_open(EVENTS)
        self.settings.SERVICE_ROLE = "live"
        self.settings.AKS_WORKER_URL = "http://aks-worker.local:8000"
        self.settings.AKS_WORKER_TOKEN = "test-secret-token"
        self.metrics["chaos_force_aks_failure"] = False

        # 1. Timeout -> fallback + trip
        def timeout_handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("worker timed out", request=request)

        trips_0 = self.metrics["circuit_breaker_trips"]
        r_timeout = asyncio.run(analyse_moment_distributed(event.frame, transport=httpx.MockTransport(timeout_handler)))
        self.assertEqual(self.metrics["circuit_breaker_trips"], trips_0 + 1)
        self.assertEqual(r_timeout.attack.moves, local_report.attack.moves)
        self.assertEqual(r_timeout.defend.moves, local_report.defend.moves)

        # 2. HTTP 500 -> fallback + trip
        def error_handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"detail": "internal error"})

        r_500 = asyncio.run(analyse_moment_distributed(event.frame, transport=httpx.MockTransport(error_handler)))
        self.assertEqual(self.metrics["circuit_breaker_trips"], trips_0 + 2)
        self.assertEqual(r_500.attack.moves, local_report.attack.moves)
        self.assertEqual(r_500.defend.moves, local_report.defend.moves)

        # 3. Chaos mode -> fallback + trip without calling worker
        self.metrics["chaos_force_aks_failure"] = True
        called = False

        def uncalled_handler(_request: httpx.Request) -> httpx.Response:
            nonlocal called
            called = True
            return httpx.Response(200, json={})

        r_chaos = asyncio.run(analyse_moment_distributed(event.frame, transport=httpx.MockTransport(uncalled_handler)))
        self.assertFalse(called)
        self.assertEqual(self.metrics["circuit_breaker_trips"], trips_0 + 3)
        self.assertEqual(r_chaos.attack.moves, local_report.attack.moves)
        self.assertEqual(r_chaos.defend.moves, local_report.defend.moves)


class LiveRevealAiDebateTest(unittest.TestCase):
    def setUp(self):
        from app.core.config import settings
        from app.services.agent_swarm import swarm

        self.settings = settings
        self.swarm = swarm
        self._orig_key = settings.AZURE_OPENAI_API_KEY
        self._orig_timeout = settings.LIVE_REVEAL_AI_TIMEOUT_S
        self._orig_client = swarm.client

    def tearDown(self):
        self.settings.AZURE_OPENAI_API_KEY = self._orig_key
        self.settings.LIVE_REVEAL_AI_TIMEOUT_S = self._orig_timeout
        self.swarm.client = self._orig_client

    def _make_runner_and_moment(self):
        runner = live_match.LiveMatchRunner()
        runner.room = MatchRoom(EVENTS, duration_s=300, window_s=30, cooldown_s=15)
        runner.room.kickoff(T0)
        event, report = _first_open(EVENTS)
        at = runner.room.real_time_of(event)
        runner.room.due_events(at)
        return runner, event, report, at

    def test_llm_path_verdict_one_voice_line_and_verified_numbers(self):
        """LLM path: generated_by == 'azure-openai', one voice line, verdict numbers match tool trace, bounded calls."""
        import json as _json
        from unittest.mock import AsyncMock, MagicMock
        from app.agents.verifier import collect_ground_truth_numbers, extract_unverified_numbers

        runner, event, report, at = self._make_runner_and_moment()
        # Connect 3 real fans sharing the same (side, language, audience) to verify bounded calls (1 debate, not 3)
        fans = [_fan(f"fan-{i}", TeamSide.AWAY, "es") for i in range(3)]
        for f in fans:
            runner.clients[object()] = f
            runner.room.join(f)

        m_preview = runner.room.open_moment(event, report, at)
        opt_frame = live_match._optimum_frame(m_preview, TeamSide.AWAY)
        metrics = opt_frame.metrics
        orig_pct = int(round(metrics.original_xt * 100))
        sim_pct = int(round(metrics.simulated_xt * 100))

        llm_payload = {
            "debate": [
                {
                    "message_id": "msg-vor-live",
                    "agent_role": "data_scientist",
                    "agent_name": "Dr. Voronoi (Científico de datos)",
                    "avatar_badge": "AI-QUANT",
                    "timestamp_label": f"{opt_frame.minute}:{opt_frame.second:02d} [SIMULACIÓN]",
                    "headline": f"Peligro ajustado del {orig_pct}% al {sim_pct}%",
                    "analysis_body": (
                        f"El xT pasa de {metrics.original_xt:.2f} a {metrics.simulated_xt:.2f} "
                        f"con un {metrics.pass_completion_prob:.1f}% de probabilidad de pase."
                    ),
                    "referenced_metric": f"Óptimo: {orig_pct}% → {sim_pct}%",
                    "highlighted_player_ids": [opt_frame.players[0].player_id],
                },
                {
                    "message_id": "msg-bia-live",
                    "agent_role": "classic_coach",
                    "agent_name": "Míster Bianchi (Entrenador clásico)",
                    "avatar_badge": "PRO-COACH",
                    "timestamp_label": f"{opt_frame.minute}:{opt_frame.second:02d} [SIMULACIÓN]",
                    "headline": f"Basculación clave para dejar el peligro en {sim_pct}%",
                    "analysis_body": (
                        f"Cerrando esa línea dejamos la ocasión en el {sim_pct}% frente al {orig_pct}% inicial "
                        f"con un {metrics.pass_completion_prob:.1f}% de pase."
                    ),
                    "referenced_metric": f"Peligro: {orig_pct}% → {sim_pct}%",
                    "highlighted_player_ids": [opt_frame.players[1].player_id],
                },
            ]
        }
        choice_msg = MagicMock()
        choice_msg.content = _json.dumps(llm_payload)
        choice_msg.tool_calls = None
        resp = MagicMock()
        resp.choices = [MagicMock(message=choice_msg)]

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=resp)
        self.settings.AZURE_OPENAI_API_KEY = "test-live-key"
        self.swarm.client = mock_client

        async def scenario():
            runner._start_debates(m_preview)
            runner.room.close_moment(m_preview.closes_at)
            await runner._finish_debates(m_preview)
            ai_debate = runner._debate_for(m_preview.id, fans[0])
            rev = runner.room.reveal_for(m_preview, fans[0], ai_debate=ai_debate)
            v_lines = MatchRoom.voice_lines(m_preview, fans[0], ai_debate=ai_debate)
            return rev, v_lines

        rev, v_lines = asyncio.run(scenario())

        self.assertEqual(rev["explanation"]["generated_by"], "azure-openai")
        self.assertEqual(mock_client.chat.completions.create.call_count, 1)  # 1 call for 3 fans on same combo
        self.assertEqual(len(v_lines), 1)
        self.assertEqual(v_lines[0][0], live_match.REVEAL_SPEAKER.value)
        self.assertIn(rev["explanation"]["body"], v_lines[0][1])

        truth = collect_ground_truth_numbers(
            opt_frame,
            tool_trace=self.swarm.orchestrator.last_report.tool_calls,
            coach_proposal=self.swarm.orchestrator.last_report.bianchi_proposal,
        )
        self.assertEqual(extract_unverified_numbers(rev["explanation"]["headline"], truth), [])
        self.assertEqual(extract_unverified_numbers(rev["explanation"]["body"], truth), [])
        self.assertEqual(extract_unverified_numbers(v_lines[0][1], truth), [])

    def test_timeout_and_exception_fallback_to_template(self):
        """Timeout path and exception path: template fallback, reveal on time."""
        from unittest.mock import AsyncMock, MagicMock

        # 1. Timeout path
        runner, event, report, at = self._make_runner_and_moment()
        fan = _fan("ana", TeamSide.HOME, "en")
        runner.clients[object()] = fan
        runner.room.join(fan)
        m1 = runner.room.open_moment(event, report, at)

        async def slow_create(**_kwargs):
            await asyncio.sleep(0.3)

        mock_slow = MagicMock()
        mock_slow.chat.completions.create = AsyncMock(side_effect=slow_create)
        self.settings.AZURE_OPENAI_API_KEY = "test-live-key"
        self.settings.LIVE_REVEAL_AI_TIMEOUT_S = 0.03
        self.swarm.client = mock_slow

        async def run_timeout():
            runner._start_debates(m1)
            runner.room.close_moment(m1.closes_at)
            await runner._finish_debates(m1)
            return runner.room.reveal_for(m1, fan, ai_debate=runner._debate_for(m1.id, fan))

        rev_timeout = asyncio.run(run_timeout())
        self.assertEqual(rev_timeout["explanation"]["generated_by"], "template")
        self.assertIn("chance of a goal", rev_timeout["explanation"]["body"])

        # 2. Exception path
        runner2, event2, report2, at2 = self._make_runner_and_moment()
        runner2.clients[object()] = fan
        runner2.room.join(fan)
        m2 = runner2.room.open_moment(event2, report2, at2)

        mock_err = MagicMock()
        mock_err.chat.completions.create = AsyncMock(side_effect=RuntimeError("Azure OpenAI 503"))
        self.settings.LIVE_REVEAL_AI_TIMEOUT_S = 5.0
        self.swarm.client = mock_err

        async def run_error():
            runner2._start_debates(m2)
            runner2.room.close_moment(m2.closes_at)
            await runner2._finish_debates(m2)
            return runner2.room.reveal_for(m2, fan, ai_debate=runner2._debate_for(m2.id, fan))

        rev_err = asyncio.run(run_error())
        self.assertEqual(rev_err["explanation"]["generated_by"], "template")
        self.assertIn("chance of a goal", rev_err["explanation"]["body"])

    def test_verifier_rejection_falls_back_to_template(self):
        """Verifier rejection (the mock invents a figure): fallback to template."""
        import json as _json
        from unittest.mock import AsyncMock, MagicMock

        runner, event, report, at = self._make_runner_and_moment()
        fan = _fan("ana", TeamSide.AWAY, "es")
        runner.clients[object()] = fan
        runner.room.join(fan)
        m = runner.room.open_moment(event, report, at)

        invented_payload = {
            "debate": [
                {
                    "message_id": "msg-inv-1",
                    "agent_role": "data_scientist",
                    "agent_name": "Dr. Voronoi",
                    "avatar_badge": "AI-QUANT",
                    "timestamp_label": "10:00 [SIMULACIÓN]",
                    "headline": "Dato inventado 742",
                    "analysis_body": "En 83 partidos hubo un 99.4% de eficacia y 0.99 xT.",
                    "referenced_metric": "99.4%",
                    "highlighted_player_ids": [101],
                },
                {
                    "message_id": "msg-inv-2",
                    "agent_role": "classic_coach",
                    "agent_name": "Míster Bianchi",
                    "avatar_badge": "PRO-COACH",
                    "timestamp_label": "10:00 [SIMULACIÓN]",
                    "headline": "Ajuste con 99% de éxito en 419 jugadas",
                    "analysis_body": "Subimos al 99% de gol tras recorrer 312 metros.",
                    "referenced_metric": "99% gol",
                    "highlighted_player_ids": [102],
                },
            ]
        }
        choice_msg = MagicMock()
        choice_msg.content = _json.dumps(invented_payload)
        choice_msg.tool_calls = None
        resp = MagicMock()
        resp.choices = [MagicMock(message=choice_msg)]

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=resp)
        self.settings.AZURE_OPENAI_API_KEY = "test-live-key"
        self.swarm.client = mock_client

        async def scenario():
            runner._start_debates(m)
            runner.room.close_moment(m.closes_at)
            await runner._finish_debates(m)
            return runner.room.reveal_for(m, fan, ai_debate=runner._debate_for(m.id, fan))

        rev = asyncio.run(scenario())
        self.assertEqual(rev["explanation"]["generated_by"], "template")
        self.assertNotIn("312", rev["explanation"]["body"])
        self.assertNotIn("419", rev["explanation"]["headline"])
        self.assertIn("probabilidad de gol", rev["explanation"]["body"])

    def test_no_key_configured_makes_no_model_call(self):
        """No key configured: no model call at all."""
        from unittest.mock import AsyncMock, MagicMock

        runner, event, report, at = self._make_runner_and_moment()
        fan = _fan("ana", TeamSide.HOME, "en")
        runner.clients[object()] = fan
        runner.room.join(fan)
        m = runner.room.open_moment(event, report, at)

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock()
        self.settings.AZURE_OPENAI_API_KEY = ""
        self.swarm.client = mock_client

        async def scenario():
            runner._start_debates(m)
            runner.room.close_moment(m.closes_at)
            await runner._finish_debates(m)
            return runner.room.reveal_for(m, fan, ai_debate=runner._debate_for(m.id, fan))

        rev = asyncio.run(scenario())
        self.assertEqual(mock_client.chat.completions.create.call_count, 0)
        self.assertEqual(rev["explanation"]["generated_by"], "template")

    def test_bots_never_trigger_a_debate(self):
        """Bots never trigger a debate."""
        from unittest.mock import AsyncMock, MagicMock

        runner, event, report, at = self._make_runner_and_moment()
        runner.bots = make_bots(25, SEED)
        for b_profile, _ in runner.bots:
            runner.room.join(b_profile)
            # Even if a bot were in clients, is_bot=True must be skipped
            runner.clients[object()] = b_profile

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock()
        self.settings.AZURE_OPENAI_API_KEY = "test-live-key"
        self.swarm.client = mock_client

        async def scenario():
            m = runner.room.open_moment(event, report, at)
            runner._start_debates(m)
            runner.room.close_moment(m.closes_at)
            await runner._finish_debates(m)
            return m

        asyncio.run(scenario())
        self.assertEqual(len(runner._debates), 0)
        self.assertEqual(mock_client.chat.completions.create.call_count, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
