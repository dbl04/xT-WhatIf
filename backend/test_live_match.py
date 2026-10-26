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

        self.assertEqual([l["agent_role"] for l in lines], ["data_scientist", "classic_coach"])
        self.assertTrue(all(l["audio_base64"] == f"audio:{l['text']}" for l in lines))
        self.assertIn("Esta vez no enviaste", lines[1]["text"])
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
