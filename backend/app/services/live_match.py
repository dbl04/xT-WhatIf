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

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.live import LiveEvent, MoveIn, Profile, Submission, SubmitIn
from app.schemas.match_contract import TeamSide
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
from app.services.narration import MOMENT_LABELS, REVEAL_TEXT, reveal_explanation

logger = logging.getLogger("xtwhatif.live")

TEAMS = (TeamSide.HOME, TeamSide.AWAY)
# A fan "found it" with this many points (community stat in the reveal).
FOUND_IT_SCORE = 900


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
        m.submissions[profile.user_id] = Submission(
            user_id=profile.user_id, team=profile.team,
            moves=[MoveIn(player_id=p, x=x, y=y) for p, x, y in moves],
            value=frame_value(m.event.frame, moves).value, legal=True, submitted_at=now,
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
    def reveal_for(self, m: Moment, profile: Profile) -> Dict[str, Any]:
        opt = m.optimum(profile.team)
        lang = profile.language
        explanation = reveal_explanation(m.event.frame, opt.mode, opt.moves, opt.base.value, opt.best.value,
                                         opt.best.target_id, lang)
        sub = m.submissions.get(profile.user_id)
        same_side = [s for s in m.submissions.values() if s.team == profile.team]
        found = sum(1 for s in same_side if (s.score or 0) >= FOUND_IT_SCORE)
        share = round(100 * found / len(same_side)) if same_side else 0
        text = REVEAL_TEXT[lang]
        if sub is None:
            personal = text["you_missed"]
        elif sub.beat_machine:
            personal = text["you_beat"]
        else:
            personal = text["you_scored"].format(score=sub.score)
        return {
            "moment_id": m.id,
            "mode": opt.mode,
            "optimum_moves": [{"player_id": p, "x": x, "y": y} for p, x, y in opt.moves],
            "optimum_target_id": opt.best.target_id,
            "your_moves": [mv.model_dump() for mv in sub.moves] if sub else [],
            "your_score": sub.score if sub else None,
            "beat_machine": bool(sub and sub.beat_machine),
            "goal_chance_pct": {"before": round(opt.base.value * 100), "best": round(opt.best.value * 100),
                                "yours": round(sub.value * 100) if sub else None},
            "explanation": {**explanation, "personal": personal,
                            "community": text["community"].format(share=share)},
            "community": {"submissions": len(same_side), "found_it_pct": share,
                          "avg_score": round(sum(s.score or 0 for s in same_side) / len(same_side)) if same_side else 0},
        }

    def ranking(self) -> List[Standing]:
        return sorted(self.standings.values(), key=lambda s: (-s.total, s.last_scored_at))

    def leaderboard_for(self, user_id: Optional[str], top: int = 10) -> Dict[str, Any]:
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
                report = await asyncio.to_thread(analyse_moment, event.frame)  # Validator: ~0.3 s
                moment = room.open_moment(event, report, now)
                if moment:
                    await self.broadcast({"type": "MOMENT_OPEN", "payload": moment.open_payload()})
                    self._schedule_bots(moment)

        await self._run_bots(now)

        if room.due_to_close(now):
            moment = room.close_moment(now)
            await self.broadcast({"type": "MOMENT_CLOSED", "payload": {"moment_id": moment.id}})
            for ws, profile in list(self.clients.items()):
                await self._send(ws, {"type": "MOMENT_REVEAL", "payload": room.reveal_for(moment, profile)})
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
        return self.room.submit(profile, data, time.time())


runner = LiveMatchRunner()
router = APIRouter(tags=["Live"])


@router.get("/api/v1/live/state")
async def live_state():
    """Current live match (no personal data): clock, score, active moment, leaderboard."""
    return runner.state_for(None)


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
