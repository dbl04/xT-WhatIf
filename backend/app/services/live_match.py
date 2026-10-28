"""
Live match room for the xT Live Challenge.

One synthetic match is played in real time (90 game minutes in LIVE_MATCH_DURATION_S
seconds) and broadcast to every connected fan. When a candidate event passes the Detector
(rules) and the Validator (the optimiser finds room to play on both sides), the moment opens
for LIVE_CHALLENGE_WINDOW_S seconds. Fans submit up to two moves for the team they support;
when the window closes every submission is scored against the optimum on the server, the
optimum is revealed with an explanation and the leaderboard is updated. While a moment is
open the match keeps running in the background and new candidates are ignored.

`MatchRoom` is the state machine (no I/O, time passed in), so it can be tested without
sleeping; `LiveMatchRunner` drives it in real time and talks to WebSocket clients.

WebSocket: /ws/live?user_id=&nickname=&team=home|away&lang=en|es&audience=...
Server -> client: MATCH_STATE, MATCH_EVENT, MOMENT_OPEN, SUBMIT_ACK, MOMENT_CLOSED,
                  MOMENT_REVEAL, LEADERBOARD, MATCH_END
Client -> server: {"type": "SUBMIT", "payload": {"moment_id": "...", "moves": [{"player_id", "x", "y"}]}}

Reveal voice: the pundits' audio is synthesised while the window is open (the optimum is known
then) and served by GET /api/v1/live/moments/{id}/voice only once the moment has closed.
"""

from __future__ import annotations

import asyncio
import heapq
import json
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.core.config import settings
from app.agents.verifier import collect_ground_truth_numbers, extract_unverified_numbers
from app.schemas.live import LiveEvent, MoveIn, Profile, Submission, SubmitIn
from app.schemas.match_contract import AgentRole, MatchFramePayload, TeamSide
from app.services.agent_swarm import swarm
from app.services.aks_client import analyse_moment_distributed
from app.services.full_match import MATCH_SECONDS, generate_full_match
from app.services.game_engine import (
    GameMode,
    MomentReport,
    Optimum,
    analyse_moment,
    frame_value,
    mode_for,
    movable_players,
    offside_line,
    score_submission,
    validate_moves,
    MAX_MOVED_PLAYERS,
    MAX_RADIUS_M,
    MIN_SPACING_M,
)
from app.services.narration import (
    MOMENT_LABELS,
    REVEAL_SPEAKER,
    REVEAL_TEXT,
    reveal_explanation,
    reveal_pundits_and_comparison,
)
from app.services.tactical_math import simulate_counterfactual
from app.services.tts_service import TTSRequest, TTSResponse, azure_tts_configured, synthesize_speech

logger = logging.getLogger("xtwhatif.live")

TEAMS = (TeamSide.HOME, TeamSide.AWAY)
# A fan "found it" with this many points (community stat in the reveal).
FOUND_IT_SCORE = 900
# Longest the voice endpoint waits for audio still being synthesised (the backend TTS timeout).
REVEAL_VOICE_WAIT_S = 7.5


def _labels(key: Optional[str]) -> Dict[str, str]:
    return MOMENT_LABELS.get(key or "", {})


def _event_summary(event: LiveEvent) -> Dict[str, Any]:
    f = event.frame
    return {
        "index": event.index,
        "minute": f.minute,
        "second": f.second,
        "event_type": f.event_type,
        "possession_team": f.possession_team.value,
        "outcome": event.outcome,
        "score": event.score.model_dump(),
        "moment_key": f.moment_key,
        "labels": _labels(f.moment_key),
    }


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
@dataclass
class Moment:
    id: str
    event: LiveEvent
    report: MomentReport
    opened_at: float
    closes_at: float
    submissions: Dict[str, Submission] = field(default_factory=dict)
    closed: bool = False

    def mode(self, team: TeamSide) -> GameMode:
        return mode_for(team, self.event.frame)

    def optimum(self, team: TeamSide) -> Optimum:
        return self.report.attack if self.mode(team) == "attack" else self.report.defend

    def open_payload(self) -> Dict[str, Any]:
        f = self.event.frame
        return {
            "moment_id": self.id,
            "event": _event_summary(self.event),
            "frame": f.model_dump(mode="json"),
            "modes": {t.value: self.mode(t) for t in TEAMS},
            "movable_player_ids": {t.value: [p.player_id for p in movable_players(f, self.mode(t))] for t in TEAMS},
            "rules": {
                "max_players": MAX_MOVED_PLAYERS,
                "max_radius_m": MAX_RADIUS_M,
                "min_spacing_m": MIN_SPACING_M,
                "offside_line_x": round(offside_line(f), 1),  # applies to the attacking side only
            },
            "opened_at_ms": int(self.opened_at * 1000),
            "closes_at_ms": int(self.closes_at * 1000),
            "window_s": round(self.closes_at - self.opened_at),
        }


@dataclass
class Standing:
    profile: Profile
    total: int = 0
    attack_total: int = 0
    defend_total: int = 0
    moments_played: int = 0
    beat_machine: bool = False
    last_scored_at: float = 0.0


class MatchRoom:
    """State machine of one live match. Every method takes `now` (epoch seconds)."""

    def __init__(self, events: List[LiveEvent], duration_s: float, window_s: float, cooldown_s: float,
                 min_moment_gap_s: float = 0.0):
        self.events = events
        self.match_id = events[0].frame.match_id if events else 0
        self.duration_s = duration_s
        self.window_s = window_s
        self.cooldown_s = cooldown_s
        self.min_moment_gap_s = min_moment_gap_s
        self.kickoff_at: Optional[float] = None
        self.next_index = 0
        self.moment: Optional[Moment] = None
        self.moments: List[Moment] = []
        self.next_moment_allowed_at = 0.0
        self.standings: Dict[str, Standing] = {}
        self.ended = False

    # --- clock -------------------------------------------------------------
    def kickoff(self, now: float) -> None:
        self.kickoff_at = now
        self.next_moment_allowed_at = now + self.min_moment_gap_s

    def real_time_of(self, event: LiveEvent) -> float:
        return (self.kickoff_at or 0.0) + event.match_seconds / MATCH_SECONDS * self.duration_s

    def match_clock(self, now: float) -> float:
        if self.kickoff_at is None:
            return 0.0
        return min(MATCH_SECONDS, (now - self.kickoff_at) / self.duration_s * MATCH_SECONDS)

    def due_events(self, now: float) -> List[LiveEvent]:
        out = []
        while self.next_index < len(self.events) and self.real_time_of(self.events[self.next_index]) <= now:
            out.append(self.events[self.next_index])
            self.next_index += 1
        return out

    @property
    def last_event(self) -> Optional[LiveEvent]:
        return self.events[self.next_index - 1] if self.next_index else None

    def finished(self) -> bool:
        return self.next_index >= len(self.events) and self.moment is None

    # --- moments -----------------------------------------------------------
    def can_open(self, event: LiveEvent, now: float) -> bool:
        """Detector rules: a candidate event, no moment open, cooldown over, time left to play it."""
        if not event.candidate or self.moment is not None or now < self.next_moment_allowed_at:
            return False
        # The window must close before the final whistle.
        return self.kickoff_at is not None and now + self.window_s <= self.kickoff_at + self.duration_s

    def open_moment(self, event: LiveEvent, report: MomentReport, now: float) -> Optional[Moment]:
        if self.moment is not None or not report.opens:
            return None
        self.moment = Moment(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"xt-whatif/live/{self.match_id}/{event.index}")),
            event=event, report=report, opened_at=now, closes_at=now + self.window_s,
        )
        self.moments.append(self.moment)
        return self.moment

    def submit(self, profile: Profile, data: SubmitIn, now: float) -> Dict[str, Any]:
        m = self.moment
        if m is None or m.id != data.moment_id or m.closed:
            return {"accepted": False, "reason": "closed"}
        if now > m.closes_at:
            return {"accepted": False, "reason": "late"}
        mode = m.mode(profile.team)
        moves = [(mv.player_id, round(mv.x, 1), round(mv.y, 1)) for mv in data.moves]
        violations = validate_moves(m.event.frame, mode, moves)
        if violations:
            return {"accepted": False, "reason": "rules",
                    "violations": [{"player_id": v.player_id, "rule": v.rule, "detail": v.detail} for v in violations]}
        val = frame_value(m.event.frame, moves).value
        opt = m.optimum(profile.team)
        score, beat_machine = score_submission(opt.mode, opt.base.value, opt.best.value, val)
        m.submissions[profile.user_id] = Submission(
            user_id=profile.user_id, team=profile.team,
            moves=[MoveIn(player_id=p, x=x, y=y) for p, x, y in moves],
            value=val, legal=True, submitted_at=now,
            score=score, beat_machine=beat_machine,
        )
        self.standings.setdefault(profile.user_id, Standing(profile=profile)).profile = profile
        return {"accepted": True, "moment_id": m.id}

    def join(self, profile: Profile) -> None:
        """A fan (or bot) is in the match: listed on the leaderboard from kickoff, with 0 points."""
        self.standings.setdefault(profile.user_id, Standing(profile=profile)).profile = profile

    def due_to_close(self, now: float) -> bool:
        return self.moment is not None and now >= self.moment.closes_at

    def close_moment(self, now: float) -> Optional[Moment]:
        """Scores every submission against its side's optimum and updates the standings."""
        m = self.moment
        if m is None:
            return None
        m.closed = True
        for sub in m.submissions.values():
            opt = m.optimum(sub.team)
            sub.score, sub.beat_machine = score_submission(opt.mode, opt.base.value, opt.best.value, sub.value)
            st = self.standings[sub.user_id]
            st.total += sub.score
            if opt.mode == "attack":
                st.attack_total += sub.score
            else:
                st.defend_total += sub.score
            st.moments_played += 1
            st.beat_machine = st.beat_machine or sub.beat_machine
            st.last_scored_at = sub.submitted_at
        self.moment = None
        self.next_moment_allowed_at = now + self.cooldown_s
        return m

    # --- reveal and leaderboard ---------------------------------------------
    @staticmethod
    def explanation(m: Moment, team: TeamSide, lang: str, audience: str = "analyst") -> Dict[str, str]:
        opt = m.optimum(team)
        return reveal_explanation(m.event.frame, opt.mode, opt.moves, opt.base.value, opt.best.value,
                                  opt.best.target_id, lang, audience)

    @classmethod
    def pundit_pack(
        cls,
        m: Moment,
        team: TeamSide,
        user_id: Optional[str],
        lang: str,
        audience: str = "analyst",
        ai_debate: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        opt = m.optimum(team)
        sub = m.submissions.get(user_id) if user_id else None
        user_moves = [(mv.player_id, mv.x, mv.y) for mv in sub.moves] if sub is not None else None
        user_score = sub.score if sub is not None else None
        beat_machine = bool(sub.beat_machine) if sub is not None else False
        if sub is not None and user_score is None:
            user_score, beat_machine = score_submission(opt.mode, opt.base.value, opt.best.value, sub.value)
        return reveal_pundits_and_comparison(
            frame=m.event.frame,
            moment_id=m.id,
            mode=opt.mode,
            opt_moves=opt.moves,
            base_value=opt.base.value,
            best_value=opt.best.value,
            best_target_id=opt.best.target_id,
            user_moves=user_moves,
            user_value=sub.value if sub is not None else None,
            user_score=user_score,
            beat_machine=beat_machine,
            lang=lang,
            audience=audience,
            ai_debate=ai_debate,
        )

    @classmethod
    def personal_text(cls, m: Moment, user_id: str, lang: str, team: Optional[TeamSide] = None) -> str:
        sub = m.submissions.get(user_id) if user_id else None
        side = team or (sub.team if sub is not None else TeamSide.HOME)
        return str(cls.pundit_pack(m, side, user_id, lang)["personal"])

    @classmethod
    def voice_lines(
        cls,
        m: Moment,
        profile: Profile,
        ai_debate: Optional[Dict[str, Any]] = None,
    ) -> List[Tuple[str, str]]:
        """What the single reveal speaker (Coach Bianchi) says out loud at the reveal."""
        pack = cls.pundit_pack(
            m, profile.team, profile.user_id, profile.language, profile.audience, ai_debate=ai_debate
        )
        return [(REVEAL_SPEAKER.value, str(pack["bianchi_voice"]))]

    def reveal_for(
        self,
        m: Moment,
        profile: Profile,
        ai_debate: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        opt = m.optimum(profile.team)
        lang = profile.language
        pack = self.pundit_pack(
            m, profile.team, profile.user_id, lang, profile.audience, ai_debate=ai_debate
        )
        sub = m.submissions.get(profile.user_id)
        same_side = [s for s in m.submissions.values() if s.team == profile.team]
        found = sum(1 for s in same_side if (s.score or 0) >= FOUND_IT_SCORE)
        share = round(100 * found / len(same_side)) if same_side else 0
        text = REVEAL_TEXT[lang]
        return {
            "moment_id": m.id,
            "mode": opt.mode,
            "optimum_moves": [{"player_id": p, "x": x, "y": y} for p, x, y in opt.moves],
            "optimum_target_id": opt.best.target_id,
            "base_target_id": opt.base.target_id,  # best receiver before any move
            "your_moves": [mv.model_dump() for mv in sub.moves] if sub else [],
            "your_score": sub.score if sub else None,
            "beat_machine": bool(sub and sub.beat_machine),
            "goal_chance_pct": {"before": round(opt.base.value * 100), "best": round(opt.best.value * 100),
                                "yours": round(sub.value * 100) if sub else None},
            "explanation": {
                "generated_by": pack["generated_by"],
                "headline": pack["headline"],
                "body": pack["body"],
                "voronoi_comparison": pack["voronoi_comparison"],
                "bianchi_headline": pack["bianchi_headline"],
                "personal": pack["personal"],
                "voronoi_voice": pack["voronoi_voice"],
                "bianchi_voice": pack["bianchi_voice"],
                "community": text["community"].format(share=share),
            },
            "pundits": pack["pundits"],
            "community": {"submissions": len(same_side), "found_it_pct": share,
                          "avg_score": round(sum(s.score or 0 for s in same_side) / len(same_side)) if same_side else 0},
        }

    def ranking(self) -> List[Standing]:
        return sorted(self.standings.values(), key=lambda s: (-s.total, s.last_scored_at))

    # 30 rows: enough to fill the leaderboard column on a tall screen; the client shows what fits.
    def leaderboard_for(self, user_id: Optional[str], top: int = 30) -> Dict[str, Any]:
        ranked = self.ranking()
        rows = [{"rank": i + 1, "nickname": s.profile.nickname, "team": s.profile.team.value,
                 "total": s.total, "is_bot": s.profile.is_bot} for i, s in enumerate(ranked[:top])]
        you = next(({"rank": i + 1, "total": s.total} for i, s in enumerate(ranked) if s.profile.user_id == user_id), None)
        teams = {}
        for t in TEAMS:
            fans = [s for s in ranked if s.profile.team == t]
            teams[t.value] = {"fans": len(fans), "avg": round(sum(s.total for s in fans) / len(fans)) if fans else 0}
        return {"top": rows, "you": you, "teams": teams, "players": len(ranked)}

    def badges(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {uid: [] for uid in self.standings}
        for uid, s in self.standings.items():
            if s.beat_machine:
                out[uid].append("beat_machine")
        played = [s for s in self.standings.values() if s.moments_played]
        if played:
            best_def = max(played, key=lambda s: s.defend_total)
            best_att = max(played, key=lambda s: s.attack_total)
            if best_def.defend_total > 0:
                out[best_def.profile.user_id].append("wall")
            if best_att.attack_total > 0:
                out[best_att.profile.user_id].append("visionary")
            out[self.ranking()[0].profile.user_id].append("player_of_the_match")
        return out


# ---------------------------------------------------------------------------
# Bots: simulated fans that keep the leaderboard alive and load the system
# ---------------------------------------------------------------------------
BOT_NAMES = ["Albion Ultra", "Rovers Fan", "Tiki Taka", "False Nine", "Low Block", "Gegenpress", "Half Space",
             "Box to Box", "Overlap", "Regista", "Sweeper", "Target Man", "Inverted Wing", "Libero"]


def make_bots(count: int, seed: int) -> List[Tuple[Profile, float]]:
    rng = random.Random(seed)
    bots = []
    for i in range(count):
        profile = Profile(
            user_id=f"bot-{i}", nickname=f"{rng.choice(BOT_NAMES)} {i}",
            team=TeamSide.HOME if rng.random() < 0.55 else TeamSide.AWAY,
            language=rng.choice(["en", "es"]), is_bot=True,
        )
        bots.append((profile, rng.betavariate(2.2, 2.0)))  # skill in [0, 1]
    return bots


def bot_moves(moment: Moment, team: TeamSide, skill: float, rng: random.Random) -> List[MoveIn]:
    """Part of the way towards the optimum, with noise; an illegal attempt falls back to no move."""
    frame = moment.event.frame
    opt = moment.optimum(team)
    by_id = {p.player_id: p for p in frame.players}
    reach = max(0.0, min(1.1, skill + rng.gauss(0.0, 0.25)))
    moves = []
    for pid, x, y in opt.moves:
        p = by_id[pid]
        moves.append((pid, round(p.x + (x - p.x) * reach + rng.gauss(0, 0.8), 1),
                      round(p.y + (y - p.y) * reach + rng.gauss(0, 0.8), 1)))
    if validate_moves(frame, moment.mode(team), moves):
        moves = []
    return [MoveIn(player_id=p, x=x, y=y) for p, x, y in moves]


def _optimum_frame(moment: Moment, side: TeamSide) -> MatchFramePayload:
    """Builds a counterfactual MatchFramePayload with the side's optimum moves applied."""
    base = moment.event.frame
    opt = moment.optimum(side)
    by_id = {p.player_id: p for p in base.players}
    modified = []
    for pid, mx, my in opt.moves:
        p = by_id.get(pid)
        if p is not None:
            modified.append(
                p.model_copy(
                    update={
                        "x": round(mx, 1),
                        "y": round(my, 1),
                        "original_x": p.x,
                        "original_y": p.y,
                        "is_modified": True,
                    }
                )
            )
    sim = simulate_counterfactual(base, modified) if modified else base.model_copy(deep=True)
    orig_xt = round(opt.base.value, 2)
    sim_xt = round(opt.best.value, 2)
    sim.metrics = sim.metrics.model_copy(
        update={
            "original_xt": orig_xt,
            "simulated_xt": sim_xt,
            "xt_delta": round(sim_xt - orig_xt, 2),
            "optimal_pass_target_id": opt.best.target_id or sim.metrics.optimal_pass_target_id,
        }
    )
    return sim


# ---------------------------------------------------------------------------
# Runner: real time + WebSocket clients
# ---------------------------------------------------------------------------
class LiveMatchRunner:
    def __init__(self):
        self.room: Optional[MatchRoom] = None
        self.clients: Dict[WebSocket, Profile] = {}
        self.task: Optional[asyncio.Task] = None
        self.seed = settings.LIVE_FIRST_SEED
        self.next_kickoff_at: Optional[float] = None
        self._bot_queue: List[Tuple[float, int, str, Profile, float]] = []
        self._bot_rng = random.Random(settings.LIVE_FIRST_SEED)
        # Reveal audio being synthesised, by (moment id, text, role, language, audience).
        self._voices: Dict[Tuple[str, str, str, str, str], asyncio.Task] = {}
        # Background multi-agent debates per (moment_id, side, language, audience).
        self._debates: Dict[Tuple[str, TeamSide, str, str], asyncio.Task] = {}
        self._debate_results: Dict[Tuple[str, TeamSide, str, str], Dict[str, Any]] = {}

    # --- lifecycle ----------------------------------------------------------
    def start(self) -> None:
        if self.task is None:
            self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            self.task = None

    def _new_match(self, now: float) -> None:
        self.room = MatchRoom(
            generate_full_match(self.seed), duration_s=settings.LIVE_MATCH_DURATION_S,
            window_s=settings.LIVE_CHALLENGE_WINDOW_S, cooldown_s=settings.LIVE_MOMENT_COOLDOWN_S,
            min_moment_gap_s=settings.LIVE_MOMENT_COOLDOWN_S,
        )
        self.room.kickoff(now)
        self.bots = make_bots(settings.LIVE_BOTS, self.seed)
        for profile, _ in self.bots:
            self.room.join(profile)
        for profile in self.clients.values():
            self.room.join(profile)
        self._bot_queue.clear()
        self.next_kickoff_at = None
        logger.info("Live match %s kicked off (seed %s, %s bots).", self.room.match_id, self.seed, len(self.bots))

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick(time.time())
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the match alive whatever a client does
                logger.exception("Live match tick failed")
            await asyncio.sleep(0.25)

    async def _tick(self, now: float) -> None:
        if self.room is None or (self.room.ended and self.next_kickoff_at and now >= self.next_kickoff_at):
            self.seed += 1 if self.room else 0
            self._new_match(now)
            await self.broadcast_state()
        room = self.room
        if room.ended:
            return

        for event in room.due_events(now):
            await self.broadcast({"type": "MATCH_EVENT", "payload": {"event": _event_summary(event),
                                                                      "frame": event.frame.model_dump(mode="json")}})
            if room.can_open(event, now):
                report = await analyse_moment_distributed(event.frame)  # Validator: AKS parallel or in-process fallback
                moment = room.open_moment(event, report, now)
                if moment:
                    await self.broadcast({"type": "MOMENT_OPEN", "payload": moment.open_payload()})
                    self._schedule_bots(moment)
                    self._start_debates(moment)
                    self._prepare_voices(moment, closed=False)

        await self._run_bots(now)

        if room.due_to_close(now):
            moment = room.close_moment(now)
            await self._finish_debates(moment)
            self._prepare_voices(moment, closed=True)
            await self.broadcast({"type": "MOMENT_CLOSED", "payload": {"moment_id": moment.id}})
            for ws, profile in list(self.clients.items()):
                ai_debate = self._debate_for(moment.id, profile)
                await self._send(ws, {"type": "MOMENT_REVEAL", "payload": room.reveal_for(moment, profile, ai_debate=ai_debate)})
                await self._send(ws, {"type": "LEADERBOARD", "payload": room.leaderboard_for(profile.user_id)})

        if room.finished() and room.kickoff_at is not None and now >= room.kickoff_at + room.duration_s:
            room.ended = True
            self.next_kickoff_at = now + settings.LIVE_INTERMISSION_S
            badges = room.badges()
            for ws, profile in list(self.clients.items()):
                await self._send(ws, {"type": "MATCH_END", "payload": {
                    "score": room.events[-1].score.model_dump() if room.events else {"home": 0, "away": 0},
                    "leaderboard": room.leaderboard_for(profile.user_id),
                    "badges": badges.get(profile.user_id, []),
                    "next_kickoff_in_s": settings.LIVE_INTERMISSION_S,
                }})

    # --- multi-agent debate during the window -------------------------------
    @staticmethod
    def _active_llm_client() -> Optional[Any]:
        key = getattr(settings, "AZURE_OPENAI_API_KEY", "") or ""
        if not key or key in ("", "your-azure-openai-key-here"):
            return None
        if key == "mock-key" and swarm.client is None:
            return None
        return swarm.client

    def _debate_for(self, moment_id: str, profile: Profile) -> Optional[Dict[str, Any]]:
        return self._debate_results.get((moment_id, profile.team, profile.language, profile.audience))

    def _start_debates(self, moment: Moment) -> None:
        """
        Starts one background multi-agent debate per (team side, language, audience) actually
        in use by connected real fans (bots are skipped).
        """
        self._debates = {k: t for k, t in self._debates.items() if k[0] == moment.id}
        self._debate_results = {k: r for k, r in self._debate_results.items() if k[0] == moment.id}
        real_combos = {
            (p.team, p.language, p.audience)
            for p in self.clients.values()
            if not p.is_bot
        }
        for side, lang, aud in real_combos:
            key = (moment.id, side, lang, aud)
            if key not in self._debates:
                self._debates[key] = asyncio.create_task(
                    self._run_moment_debate(moment, side, lang, aud)
                )

    async def _run_moment_debate(
        self, moment: Moment, side: TeamSide, lang: str, aud: str
    ) -> Dict[str, Any]:
        key = (moment.id, side, lang, aud)
        deployment = settings.AZURE_OPENAI_DEPLOYMENT_REASONING
        active_client = self._active_llm_client()
        if active_client is None:
            res = {
                "generated_by": "template",
                "latency_ms": 0.0,
                "deployment": deployment,
                "model_calls": 0,
            }
            self._debate_results[key] = res
            return res

        t0 = time.perf_counter()
        timeout_s = max(0.01, float(getattr(settings, "LIVE_REVEAL_AI_TIMEOUT_S", 15.0) or 15.0))
        try:
            opt_frame = _optimum_frame(moment, side)
            report = await asyncio.wait_for(
                swarm.orchestrator.run_debate(
                    opt_frame, language=lang, audience=aud, client=active_client
                ),
                timeout=timeout_s,
            )
            latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            ver = report.verification
            if (
                not report.used_llm
                or ver is None
                or ver.fell_back_to_template
                or not ver.all_matched_initially
            ):
                res = {
                    "generated_by": "template",
                    "latency_ms": latency_ms,
                    "deployment": deployment,
                    "model_calls": report.model_calls,
                }
                self._debate_results[key] = res
                return res

            by_role = {m.agent_role: m for m in ver.messages}
            speaker_msg = by_role.get(REVEAL_SPEAKER)
            voronoi_msg = by_role.get(AgentRole.DATA_SCIENTIST)
            truth = collect_ground_truth_numbers(
                opt_frame, tool_trace=report.tool_calls, coach_proposal=report.bianchi_proposal
            )
            if speaker_msg is None or any(
                extract_unverified_numbers(txt, truth)
                for txt in (speaker_msg.headline, speaker_msg.analysis_body, speaker_msg.referenced_metric)
            ):
                res = {
                    "generated_by": "template",
                    "latency_ms": latency_ms,
                    "deployment": deployment,
                    "model_calls": report.model_calls,
                }
                self._debate_results[key] = res
                return res

            res = {
                "generated_by": "azure-openai",
                "headline": speaker_msg.headline,
                "body": speaker_msg.analysis_body,
                "referenced_metric": speaker_msg.referenced_metric,
                "voronoi_headline": voronoi_msg.headline if voronoi_msg else "",
                "voronoi_body": voronoi_msg.analysis_body if voronoi_msg else "",
                "voronoi_metric": voronoi_msg.referenced_metric if voronoi_msg else "",
                "latency_ms": latency_ms,
                "deployment": deployment,
                "model_calls": report.model_calls,
            }
            self._debate_results[key] = res
            if not moment.closed:
                self._prepare_voices(moment, closed=False)
            return res
        except Exception as exc:
            latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            logger.warning("Live moment %s AI debate fallback to template (%s)", moment.id, exc)
            res = {
                "generated_by": "template",
                "latency_ms": latency_ms,
                "deployment": deployment,
                "model_calls": getattr(swarm.orchestrator, "_last_turn_model_calls", 1),
            }
            self._debate_results[key] = res
            return res

    async def _finish_debates(self, moment: Moment) -> None:
        keys = [k for k in list(self._debates) if k[0] == moment.id]
        if keys:
            await asyncio.gather(*(self._debates[k] for k in keys), return_exceptions=True)
        results = [self._debate_results[k] for k in keys if k in self._debate_results]
        source = (
            "azure-openai"
            if any(r.get("generated_by") == "azure-openai" for r in results)
            else "template"
        )
        max_latency_ms = max((float(r.get("latency_ms", 0.0)) for r in results), default=0.0)
        total_calls = sum(int(r.get("model_calls", 0)) for r in results)
        logger.info(
            "Live moment %s reveal: generated_by=%s latency_ms=%.1f deployment=%s model_calls=%d combos=%d",
            moment.id,
            source,
            max_latency_ms,
            settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
            total_calls,
            len(keys),
        )

    # --- bots ---------------------------------------------------------------
    def _schedule_bots(self, moment: Moment) -> None:
        for i, (profile, skill) in enumerate(self.bots):
            at = moment.opened_at + self._bot_rng.uniform(2.0, max(2.5, moment.closes_at - moment.opened_at - 1.0))
            heapq.heappush(self._bot_queue, (at, i, moment.id, profile, skill))

    async def _run_bots(self, now: float) -> None:
        room = self.room
        while self._bot_queue and self._bot_queue[0][0] <= now:
            _, _, moment_id, profile, skill = heapq.heappop(self._bot_queue)
            if room.moment is None or room.moment.id != moment_id:
                continue
            moves = bot_moves(room.moment, profile.team, skill, self._bot_rng)
            room.submit(profile, SubmitIn(moment_id=moment_id, moves=moves), now)

    # --- reveal voice -------------------------------------------------------
    def _voice_task(self, moment: Moment, role: str, text: str, profile: Profile) -> asyncio.Task:
        key = (moment.id, text, role, profile.language, profile.audience)
        task = self._voices.get(key)
        if task is None:
            request = TTSRequest(text=text[:1200], agent_role=role, language=profile.language,
                                 audience=profile.audience)
            task = self._voices[key] = asyncio.create_task(synthesize_speech(request))
        return task

    def _prepare_voices(self, moment: Moment, closed: bool) -> None:
        """
        Starts the reveal audio early so it plays as soon as the moment closes. On open: the
        default (no-submission) spoken line for every connected fan's side, language and
        audience; on close: each fan's personalised spoken line from `REVEAL_SPEAKER`.
        Same texts share one synthesis.
        """
        if not closed:
            self._voices = {k: t for k, t in self._voices.items() if k[0] == moment.id}
        if not azure_tts_configured():
            return
        for profile in list(self.clients.values()):
            if profile.is_bot:
                continue
            ai_debate = self._debate_for(moment.id, profile)
            if closed:
                for role, text in MatchRoom.voice_lines(moment, profile, ai_debate=ai_debate):
                    self._voice_task(moment, role, text, profile)
                continue
            no_sub = profile.model_copy(update={"user_id": ""})
            for role, text in MatchRoom.voice_lines(moment, no_sub, ai_debate=ai_debate):
                self._voice_task(moment, role, text, profile)
            if profile.user_id in moment.submissions:
                for role, text in MatchRoom.voice_lines(moment, profile, ai_debate=ai_debate):
                    self._voice_task(moment, role, text, profile)

    async def reveal_voice(self, moment_id: str, user_id: str) -> Optional[List[Dict[str, Any]]]:
        """The fan's reveal line with its audio (None: browser voice); None if not revealed yet."""
        room = self.room
        moment = next((m for m in room.moments if m.id == moment_id), None) if room else None
        standing = room.standings.get(user_id) if room else None
        if moment is None or not moment.closed or standing is None:
            return None
        profile = standing.profile
        ai_debate = self._debate_for(moment.id, profile)
        lines = MatchRoom.voice_lines(moment, profile, ai_debate=ai_debate)
        audio: List[Optional[str]] = [None] * len(lines)
        if azure_tts_configured():
            tasks = [self._voice_task(moment, role, text, profile) for role, text in lines]
            try:
                done: List[TTSResponse] = await asyncio.wait_for(
                    asyncio.gather(*(asyncio.shield(t) for t in tasks)), timeout=REVEAL_VOICE_WAIT_S)
                audio = [r.audio_base64 for r in done]
            except asyncio.TimeoutError:
                audio = [t.result().audio_base64 if t.done() and not t.exception() else None for t in tasks]
        return [{"agent_role": role, "text": text, "audio_base64": a} for (role, text), a in zip(lines, audio)]

    # --- clients ------------------------------------------------------------
    def state_for(self, profile: Optional[Profile]) -> Dict[str, Any]:
        room = self.room
        if room is None:
            self._new_match(time.time()); room = self.room
        now = time.time()
        recent = room.events[max(0, room.next_index - 5):room.next_index] or (room.events[:1] if room.events else [])
        last = room.last_event or (room.events[0] if room.events else None)
        return {
            "status": "ended" if room.ended else "live",
            "match_id": room.match_id,
            "match_info": room.events[0].frame.match_info.model_dump(mode="json") if room.events else None,
            "clock_seconds": round(room.match_clock(now)),
            "duration_s": room.duration_s,
            "score": room.last_event.score.model_dump() if room.last_event else {"home": 0, "away": 0},
            "frame": last.frame.model_dump(mode="json") if last else None,
            "recent_events": [_event_summary(e) for e in recent],
            "active_moment": room.moment.open_payload() if room.moment else None,
            "leaderboard": room.leaderboard_for(profile.user_id if profile else None),
            "next_kickoff_in_s": max(0, round(self.next_kickoff_at - now)) if self.next_kickoff_at else None,
        }

    async def broadcast_state(self) -> None:
        for ws, profile in list(self.clients.items()):
            await self._send(ws, {"type": "MATCH_STATE", "payload": self.state_for(profile)})

    async def broadcast(self, message: Dict[str, Any]) -> None:
        await asyncio.gather(*(self._send(ws, message) for ws in list(self.clients)))

    async def _send(self, ws: WebSocket, message: Dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(ws.send_json(message), timeout=2.0)
        except Exception:
            self.clients.pop(ws, None)

    def submit(self, profile: Profile, data: SubmitIn) -> Dict[str, Any]:
        if self.room is None:
            return {"accepted": False, "reason": "closed"}
        ack = self.room.submit(profile, data, time.time())
        if ack.get("accepted") and not profile.is_bot and self.room.moment is not None and azure_tts_configured():
            ai_debate = self._debate_for(self.room.moment.id, profile)
            for role, text in MatchRoom.voice_lines(self.room.moment, profile, ai_debate=ai_debate):
                self._voice_task(self.room.moment, role, text, profile)
        return ack


runner = LiveMatchRunner()
router = APIRouter(tags=["Live"])


@router.get("/api/v1/live/state")
async def live_state():
    """Current live match (no personal data): clock, score, active moment, leaderboard."""
    return runner.state_for(None)


@router.get("/api/v1/live/moments/{moment_id}/voice")
async def live_reveal_voice(moment_id: str, user_id: str):
    """
    The pundits' reveal audio for one fan, pre-synthesised during the window. Served only after
    the moment has closed, so it never gives the optimum away early.
    """
    lines = await runner.reveal_voice(moment_id, user_id)
    if lines is None:
        raise HTTPException(status_code=404, detail="No revealed moment for this fan")
    return {"moment_id": moment_id, "lines": lines}


@router.websocket("/ws/live")
async def live_socket(websocket: WebSocket):
    q = websocket.query_params
    try:
        profile = Profile(
            user_id=q.get("user_id", ""), nickname=q.get("nickname", ""), team=q.get("team", ""),
            language=q.get("lang", "en"), audience=q.get("audience", "analyst"),
        )
    except ValidationError:
        await websocket.close(code=1008, reason="Invalid profile")
        return
    await websocket.accept()
    runner.clients[websocket] = profile; runner._new_match(time.time()) if runner.room is None else None
    if runner.room is not None:
        runner.room.join(profile)
        if runner.room.moment is not None and not runner.room.moment.closed:
            runner._start_debates(runner.room.moment)
            runner._prepare_voices(runner.room.moment, closed=False)
    await runner._send(websocket, {"type": "MATCH_STATE", "payload": runner.state_for(profile)})
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8")) > settings.WS_MAX_MESSAGE_BYTES:
                await websocket.close(code=1009, reason="Message too large")
                break
            try:
                message = json.loads(raw)
                if message.get("type") != "SUBMIT":
                    continue
                data = SubmitIn(**message.get("payload", {}))
            except (ValueError, ValidationError):
                await runner._send(websocket, {"type": "SUBMIT_ACK", "payload": {"accepted": False, "reason": "invalid"}})
                continue
            await runner._send(websocket, {"type": "SUBMIT_ACK", "payload": runner.submit(profile, data)})
    except WebSocketDisconnect:
        pass
    finally:
        runner.clients.pop(websocket, None)
