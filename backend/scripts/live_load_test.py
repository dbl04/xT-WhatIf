"""
Load test for the live match: N real fans over WebSocket against a deployed (or local)
live-match service. Unlike the in-process bots, these connections go through the ingress,
so they exercise what Azure has to scale.

Every fan joins /ws/live with its own id and team, and on each MOMENT_OPEN submits a small
legal-looking move after a random think time. The report shows connections, messages,
moments played, submissions accepted / rejected and message latency.

Usage (from backend/):
    python scripts/live_load_test.py --url ws://localhost:8000 --fans 200 --duration 120
    python scripts/live_load_test.py --url wss://xt-whatif-live.<env-domain> --fans 1000 --duration 300
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import statistics
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import List
from urllib.parse import urlencode

import websockets


@dataclass
class Stats:
    connected: int = 0
    failed: int = 0
    dropped: int = 0
    messages: Counter = field(default_factory=Counter)
    accepted: int = 0
    rejected: Counter = field(default_factory=Counter)
    # Seconds from a moment opening (server time) to the fan receiving MOMENT_OPEN.
    open_latency: List[float] = field(default_factory=list)
    moments: set = field(default_factory=set)


async def fan(index: int, url: str, deadline: float, stats: Stats, rng: random.Random) -> None:
    team = "home" if rng.random() < 0.55 else "away"
    query = urlencode({
        "user_id": f"load-{uuid.uuid4().hex[:12]}",
        "nickname": f"Load {index}",
        "team": team,
        "lang": rng.choice(["en", "es"]),
    })
    opened = False
    try:
        async with websockets.connect(f"{url.rstrip('/')}/ws/live?{query}", max_size=2 ** 22, open_timeout=20) as ws:
            opened = True
            stats.connected += 1
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.time()))
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                kind, payload = msg.get("type"), msg.get("payload", {})
                stats.messages[kind] += 1
                if kind == "MOMENT_OPEN":
                    stats.moments.add(payload["moment_id"])
                    stats.open_latency.append(max(0.0, time.time() - payload["opened_at_ms"] / 1000))
                    asyncio.create_task(play(ws, payload, team, rng))
                elif kind == "SUBMIT_ACK":
                    if payload.get("accepted"):
                        stats.accepted += 1
                    else:
                        stats.rejected[payload.get("reason", "?")] += 1
    except (OSError, websockets.exceptions.WebSocketException, asyncio.TimeoutError):
        if opened:
            stats.dropped += 1
        else:
            stats.failed += 1


async def play(ws, moment: dict, team: str, rng: random.Random) -> None:
    """Think for a while, then move one movable player 1-4 m (sometimes keep the shape)."""
    await asyncio.sleep(rng.uniform(1.0, max(1.5, moment["window_s"] - 3.0)))
    movable = set(moment["movable_player_ids"][team])
    players = [p for p in moment["frame"]["players"] if p["player_id"] in movable]
    moves = []
    if players and rng.random() < 0.85:
        p = rng.choice(players)
        r, a = rng.uniform(1.0, 4.0), rng.uniform(0, 2 * math.pi)
        moves.append({"player_id": p["player_id"],
                      "x": round(min(119.0, max(1.0, p["x"] + r * math.cos(a))), 1),
                      "y": round(min(79.0, max(1.0, p["y"] + r * math.sin(a))), 1)})
    try:
        await ws.send(json.dumps({"type": "SUBMIT", "payload": {"moment_id": moment["moment_id"], "moves": moves}}))
    except websockets.exceptions.WebSocketException:
        pass


async def main() -> None:
    parser = argparse.ArgumentParser(description="Load test the live match with real WebSocket fans.")
    parser.add_argument("--url", default="ws://localhost:8000", help="WebSocket origin of the live-match service")
    parser.add_argument("--fans", type=int, default=200)
    parser.add_argument("--duration", type=float, default=120.0, help="Seconds to stay connected")
    parser.add_argument("--ramp", type=float, default=10.0, help="Seconds over which the fans connect")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    stats = Stats()
    start = time.time()
    deadline = start + args.duration
    tasks = []
    for i in range(args.fans):
        tasks.append(asyncio.create_task(fan(i, args.url, deadline, stats, random.Random(rng.random()))))
        await asyncio.sleep(args.ramp / max(1, args.fans))
    await asyncio.gather(*tasks)

    lat = sorted(stats.open_latency)
    pct = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))] if lat else float("nan")
    print(f"fans: {args.fans}  connected: {stats.connected}  failed: {stats.failed}  dropped: {stats.dropped}")
    print(f"duration: {time.time() - start:.0f} s  moments seen: {len(stats.moments)}")
    print("messages: " + ", ".join(f"{k} {v}" for k, v in sorted(stats.messages.items())))
    print(f"submissions accepted: {stats.accepted}  rejected: {dict(stats.rejected)}")
    if lat:
        print(f"MOMENT_OPEN delivery (s): median {statistics.median(lat):.3f}  p95 {pct(0.95):.3f}  max {lat[-1]:.3f}")


if __name__ == "__main__":
    asyncio.run(main())
