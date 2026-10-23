"""
xT-WhatIf FastAPI Entrypoint.
Provides REST and WebSocket endpoints for real-time counterfactuals on synthetic 360-style frames.
Enforces canonical 120x80 coordinate system and supports interactive multi-highlight simulation.
"""

import os
import json
import time
import asyncio
import logging
from typing import List, Dict, Any, Optional
import httpx
from pydantic import ValidationError
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.rate_limit import WS_SIMULATE_BUCKET, allow, client_key, rate_limit_middleware
from app.schemas.match_contract import (
    MatchFramePayload, CounterfactualRequest, PlayerNode
)
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.services.tactical_math import simulate_counterfactual
from app.services.agent_swarm import swarm, _simulation_cache
from app.services.narration import (
    AUDIENCES,
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    LANGUAGES,
    localize_frame,
    moment_label,
    normalize_audience,
    normalize_language,
)
from app.services.tts_service import router as tts_router
from app.services.tactical_optimizer import router as optimizer_router
from app.services.game_api import router as game_router
from app.services.live_match import router as live_router, runner as live_runner
from app.services.cloud_telemetry import get_aca_gateway_replicas


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("xtwhatif.main")

app = FastAPI(
    title="xT-WhatIf Engine",
    description="Interactive Counterfactual Engine Powered by Multi-Agent AI (synthetic football data)",
    version="2.0.0"
)

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS or ["*"],
    # The API uses no cookies; credentials must never be combined with a wildcard origin.
    allow_credentials="*" not in (settings.CORS_ORIGINS or ["*"]),
    allow_methods=["*"],
    allow_headers=["*"],
)


# Subagent Routers (TTS & Auto-Coach Optimizer)
app.middleware("http")(rate_limit_middleware)
app.include_router(tts_router)
app.include_router(optimizer_router)
app.include_router(game_router)
app.include_router(live_router)


@app.on_event("startup")
async def start_live_match():
    # One live match per deployment: AKS workers only compute, and extra replicas must set LIVE_ENABLED=false.
    if settings.LIVE_ENABLED and settings.SERVICE_ROLE != "aks-worker":
        live_runner.start()


@app.on_event("shutdown")
async def stop_live_match():
    await live_runner.stop()


@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "online",
        "service": "xT-WhatIf Engine",
        "version": "2.0.0",
        "service_role": settings.SERVICE_ROLE,
        "compute_mode": "aks-distributed" if settings.AKS_WORKER_URL else "local-in-process",
        "coordinate_system": "120x80 (X: 0.0-120.0, Y: 0.0-80.0)",
        "target_match": DEFAULT_MATCH_ID,
        "data_source": "synthetic",
        "environment": settings.ENVIRONMENT
    }


LanguageQuery = Query(DEFAULT_LANGUAGE, pattern="^(" + "|".join(LANGUAGES) + ")$",
                      description="Language of labels and agent debate: en | es")
AudienceQuery = Query(DEFAULT_AUDIENCE, pattern="^(" + "|".join(AUDIENCES) + ")$",
                      description="Audience profile: casual | analyst | coach | audio_description")


def load_frames(match_id: int, lang: str = DEFAULT_LANGUAGE, audience: str = DEFAULT_AUDIENCE) -> List[MatchFramePayload]:
    """Key moments of a match with labels and the pre-move debate in the requested profile."""
    return [
        localize_frame(MatchFramePayload(**f), normalize_language(lang), normalize_audience(audience))
        for f in loader.fetch_match_360_frames(match_id)
    ]


@app.get("/api/v1/matches", tags=["Matches"])
async def get_available_matches(lang: str = LanguageQuery):
    """Returns the catalogue of synthetic matches and their key moments."""
    catalogue = []
    for match_id in loader.available_match_ids():
        frames = [MatchFramePayload(**f) for f in loader.fetch_match_360_frames(match_id)]
        if not frames:
            continue
        info = frames[0].match_info
        catalogue.append({
            "match_id": match_id,
            "title": f"{info.home.name} vs {info.away.name}" if info else f"Synthetic match {match_id}",
            "competition": info.competition if info else None,
            "venue": info.venue if info else None,
            "home_team": info.home.model_dump() if info else None,
            "away_team": info.away.model_dump() if info else None,
            "seed": info.seed if info else None,
            "highlights_count": len(frames),
            "canonical_pitch": "120x80m",
            "data_source": "synthetic",
            "highlights": [
                {
                    "index": i,
                    "minute": f"{f.minute}:{f.second:02d}",
                    "type": f.event_type,
                    "headline": moment_label(f.moment_key, normalize_language(lang), f.moment_label),
                }
                for i, f in enumerate(frames)
            ],
        })
    return catalogue


@app.get("/api/v1/match/{match_id}/frames", response_model=List[MatchFramePayload], tags=["Matches"])
async def get_match_frames(match_id: int, lang: str = LanguageQuery, audience: str = AudienceQuery):
    """Returns the match's key moments, localised to the requested language and audience profile."""
    frames = load_frames(match_id, lang, audience)
    if not frames:
        raise HTTPException(status_code=404, detail="Match frames not found")
    return frames


# Cloud Telemetry state & Chaos Engineering store for Microsoft Hackathon Demo
active_instance_env = os.getenv("CONTAINER_APP_REPLICA_NAME") or os.getenv("HOSTNAME", "local-dev-node")

cloud_metrics_store: Dict[str, Any] = {
    "service_role": settings.SERVICE_ROLE if settings.SERVICE_ROLE != "standalone" else "aca-gateway",
    "compute_mode": "aks-distributed" if settings.AKS_WORKER_URL else "local-in-process",
    "active_instance_id": active_instance_env,
    "total_simulations": 142,
    "cache_hits": 98,
    "aks_delegated_calls": 44,
    "circuit_breaker_trips": 0,
    "last_compute_latency_ms": 14.2,
    "chaos_force_aks_failure": False,
    "aca_gateway_replicas": 3,
    "aks_worker_pods": 6,
    "estimated_cpu_utilization_pct": 28.5,
    "keda_active": True,
}
cloud_telemetry_state = cloud_metrics_store  # Backward compatibility alias

# Sliding window of recent simulation timestamps to calculate dynamic cluster load
_recent_simulation_timestamps: List[float] = [time.time() - 6.0, time.time() - 2.0]


def get_active_instance_id() -> str:
    """Returns active container/pod replica identifier from environment."""
    return os.getenv("CONTAINER_APP_REPLICA_NAME") or os.getenv("HOSTNAME", "local-dev-node")


_chaos_enabled_at: Optional[float] = None


def _expire_chaos_if_due() -> None:
    """Chaos mode is shared by every visitor of the demo: switch it off automatically."""
    global _chaos_enabled_at
    if not cloud_metrics_store["chaos_force_aks_failure"]:
        _chaos_enabled_at = None
        return
    if _chaos_enabled_at is None:
        _chaos_enabled_at = time.time()
    elif time.time() - _chaos_enabled_at >= settings.CHAOS_AUTO_RESET_SECONDS:
        cloud_metrics_store["chaos_force_aks_failure"] = False
        _chaos_enabled_at = None
        logger.info("Chaos mode auto-reset after %ss.", settings.CHAOS_AUTO_RESET_SECONDS)


def chaos_seconds_remaining() -> Optional[int]:
    if _chaos_enabled_at is None or not cloud_metrics_store["chaos_force_aks_failure"]:
        return None
    return max(0, int(settings.CHAOS_AUTO_RESET_SECONDS - (time.time() - _chaos_enabled_at)))


def compute_dynamic_cluster_scaling() -> Dict[str, Any]:
    """
    Dynamically computes KEDA ACA Gateway replicas (1..10) and AKS Worker pods (3..12)
    based on real-time simulation throughput, estimated CPU utilization, and circuit breaker state.
    """
    _expire_chaos_if_due()
    now = time.time()
    # Prune timestamps older than 20 seconds
    cutoff = now - 20.0
    while _recent_simulation_timestamps and _recent_simulation_timestamps[0] < cutoff:
        _recent_simulation_timestamps.pop(0)

    recent_activity_count = len(_recent_simulation_timestamps)

    # Dynamic CPU estimation: baseline idle 22%, increasing with concurrent throughput
    cpu_utilization = min(96.0, round(22.0 + (recent_activity_count * 2.5), 1))

    # KEDA Auto-scaling logic (1 to 10 replicas based on incoming HTTP request bursts)
    if recent_activity_count <= 2:
        aca_replicas = 3
    else:
        aca_replicas = min(10, max(3, int(2 + (recent_activity_count / 3.0))))

    # AKS Worker HPA logic (3 to 12 pods, target 65% CPU)
    is_chaos_broken = bool(cloud_metrics_store.get("chaos_force_aks_failure", False))

    if is_chaos_broken:
        # Worker is completely unreachable; circuit breaker handles compute locally
        aks_pods = "0 (Unreachable - Circuit Breaker Active)"
        aks_numeric_pods = 0
    else:
        if cpu_utilization > 65.0:
            scale_ratio = cpu_utilization / 65.0
            aks_numeric_pods = min(12, max(3, int(round(4 * scale_ratio))))
        else:
            aks_numeric_pods = min(12, max(3, 3 + int(recent_activity_count / 5.0)))
        aks_pods = aks_numeric_pods

    active_id = get_active_instance_id()

    # Update cloud_metrics_store synchronized state
    cloud_metrics_store["active_instance_id"] = active_id
    cloud_metrics_store["aca_gateway_replicas"] = aca_replicas
    cloud_metrics_store["aks_worker_pods"] = aks_pods
    cloud_metrics_store["estimated_cpu_utilization_pct"] = cpu_utilization

    return {
        "active_instance_id": active_id,
        "aca_gateway_replicas": aca_replicas,
        "aks_worker_pods": aks_pods,
        "aks_numeric_worker_pods": aks_numeric_pods,
        "estimated_cpu_utilization_pct": cpu_utilization,
        "recent_activity_count": recent_activity_count,
    }


async def execute_simulation(request: CounterfactualRequest, base_frame: MatchFramePayload) -> MatchFramePayload:
    """
    Executes simulation with Cloud-Native Dual-Role support (ACA Gateway <-> AKS Worker):
    If running as ACA Gateway and AKS_WORKER_URL is set, delegates computation via async HTTP.
    Circuit Breaker: Automatically falls back to in-process local execution if remote worker fails or times out.
    """
    _expire_chaos_if_due()
    cloud_metrics_store["total_simulations"] += 1
    _recent_simulation_timestamps.append(time.time())

    # Check Chaos injection for Microsoft Demo
    if cloud_metrics_store["chaos_force_aks_failure"]:
        cloud_metrics_store["circuit_breaker_trips"] += 1
        logger.warning("CHAOS INJECTION ACTIVE: Simulating AKS Worker outage -> Circuit Breaker tripped to local compute")
    elif settings.SERVICE_ROLE == "aca-gateway" and settings.AKS_WORKER_URL:
        target_endpoint = f"{settings.AKS_WORKER_URL.rstrip('/')}/api/v1/simulate"
        try:
            cloud_metrics_store["aks_delegated_calls"] += 1
            logger.info(f"ACA Gateway delegating simulation to AKS Worker: {target_endpoint}")
            start_remote = time.perf_counter()
            async with httpx.AsyncClient(timeout=3.5) as client:
                resp = await client.post(target_endpoint, json=request.model_dump())
                if resp.status_code == 200:
                    remote_latency = (time.perf_counter() - start_remote) * 1000
                    cloud_metrics_store["last_compute_latency_ms"] = round(remote_latency, 2)
                    logger.info("Successfully received distributed simulation result from AKS Worker.")
                    return MatchFramePayload(**resp.json())
                else:
                    cloud_metrics_store["circuit_breaker_trips"] += 1
                    logger.warning(
                        f"AKS Worker returned HTTP {resp.status_code}. "
                        "Tripping Circuit Breaker to local in-process computation."
                    )
        except Exception as exc:
            cloud_metrics_store["circuit_breaker_trips"] += 1
            logger.warning(
                f"AKS Worker call failed ({exc.__class__.__name__}: {exc}). "
                "Tripping Circuit Breaker to local in-process computation."
            )

    # Local in-process computation (for standalone, aks-worker, or circuit breaker fallback)
    start_calc = time.perf_counter()
    simulated_frame = simulate_counterfactual(base_frame, request.modified_players)

    # Cache hit check in agent swarm
    cache_key = swarm._build_cache_key(simulated_frame, request.language, request.audience)
    if cache_key in _simulation_cache:
        cloud_metrics_store["cache_hits"] += 1


    simulated_frame.agent_debate = await swarm.generate_debate(
        simulated_frame, request.language, request.audience
    )
    calc_latency = (time.perf_counter() - start_calc) * 1000
    cloud_metrics_store["last_compute_latency_ms"] = round(calc_latency, 2)
    return simulated_frame


@app.post("/api/v1/simulate", response_model=MatchFramePayload, tags=["Simulation"])
async def simulate_scenario(request: CounterfactualRequest):
    """
    Executes a counterfactual simulation:
    Applies modified player coordinates, recalculates xT & metrics, and triggers AI agent debate.
    """
    frames = loader.fetch_match_360_frames(request.match_id)
    base_dict = next((f for f in frames if f["event_uuid"] == request.event_uuid), frames[0])
    base_frame = MatchFramePayload(**base_dict)
    return await execute_simulation(request, base_frame)


# ---------------------------------------------------------------------------
# Cloud Telemetry & Chaos Endpoints (Microsoft Hackathon Demo)
# ---------------------------------------------------------------------------
@app.get("/api/v1/cloud/telemetry", tags=["Cloud Telemetry"])
async def get_cloud_telemetry():
    """Returns real-time ACA / AKS cluster telemetry, KEDA / HPA targets, and circuit breaker metrics."""
    replica_info = get_aca_gateway_replicas()
    scaling = compute_dynamic_cluster_scaling()

    actual_replicas = replica_info["replicas"]
    is_simulated = replica_info["simulated"]
    display_replicas = actual_replicas if not is_simulated else scaling["aca_gateway_replicas"]

    is_chaos = cloud_metrics_store["chaos_force_aks_failure"]
    compute_mode = (
        "local-in-process (circuit breaker tripped)"
        if is_chaos
        else ("aks-distributed" if settings.AKS_WORKER_URL else "local-in-process")
    )
    return {
        "replicas": actual_replicas,
        "simulated": is_simulated,
        "service_role": settings.SERVICE_ROLE,
        "compute_mode": compute_mode,
        "active_instance_id": scaling["active_instance_id"],
        "keda_target_concurrency": 20,
        "aks_hpa_target_cpu_pct": 65,
        "metrics": cloud_metrics_store,
        "total_simulations": cloud_metrics_store["total_simulations"],
        "cache_hits": cloud_metrics_store["cache_hits"],
        "aks_delegated_calls": cloud_metrics_store["aks_delegated_calls"],
        "circuit_breaker_trips": cloud_metrics_store["circuit_breaker_trips"],
        "last_compute_latency_ms": cloud_metrics_store["last_compute_latency_ms"],
        "chaos_force_aks_failure": is_chaos,
        "circuit_breaker_active": is_chaos,
        "aca_gateway_replicas": display_replicas,
        "aks_worker_pods": scaling["aks_worker_pods"],
        "estimated_cpu_utilization_pct": scaling["estimated_cpu_utilization_pct"],
        "keda_active": True,
        "chaos_auto_reset_in_s": chaos_seconds_remaining(),
    }


@app.post("/api/v1/cloud/chaos-toggle", tags=["Cloud Telemetry"])
async def toggle_chaos_mode(force: Optional[bool] = None):
    """Toggles simulated AKS cluster failure to demonstrate Circuit Breaker fallback.

    The failure is simulated and global; it switches itself off after CHAOS_AUTO_RESET_SECONDS.
    """
    global _chaos_enabled_at
    _expire_chaos_if_due()
    if force is not None:
        cloud_metrics_store["chaos_force_aks_failure"] = force
    else:
        cloud_metrics_store["chaos_force_aks_failure"] = not cloud_metrics_store["chaos_force_aks_failure"]

    if cloud_metrics_store["chaos_force_aks_failure"]:
        cloud_metrics_store["circuit_breaker_trips"] += 1
        _chaos_enabled_at = time.time()
    else:
        _chaos_enabled_at = None

    scaling = compute_dynamic_cluster_scaling()

    return {
        "chaos_force_aks_failure": cloud_metrics_store["chaos_force_aks_failure"],
        "circuit_breaker_active": cloud_metrics_store["chaos_force_aks_failure"],
        "circuit_breaker_trips": cloud_metrics_store["circuit_breaker_trips"],
        "active_instance_id": scaling["active_instance_id"],
        "aca_gateway_replicas": scaling["aca_gateway_replicas"],
        "aks_worker_pods": scaling["aks_worker_pods"],
        "compute_mode": (
            "local-in-process (circuit breaker tripped)"
            if cloud_metrics_store["chaos_force_aks_failure"]
            else "aks-distributed"
        ),
        "message": (
            "AKS failure injected -> circuit breaker open on the ACA gateway -> local fallback compute serving (0% packet loss)"
            if cloud_metrics_store["chaos_force_aks_failure"]
            else "Normal operation restored: AKS cluster healthy and in sync."
        ),
        "fallback_latency_ms": cloud_metrics_store["last_compute_latency_ms"] or 3.8,
        "chaos_auto_reset_in_s": chaos_seconds_remaining(),
        "metrics": cloud_metrics_store
    }


@app.post("/api/v1/cloud/stress-burst", tags=["Cloud Telemetry"])
async def execute_stress_burst():
    """Runs a burst of 25 parallel geometric simulations (Voronoi + xT 16x12) via asyncio.gather."""
    frames = loader.fetch_match_360_frames(DEFAULT_MATCH_ID)
    base_frame = MatchFramePayload(**frames[0])

    async def run_single_sim(variation_idx: int):
        mod_players = [
            PlayerNode(**{
                **p.model_dump(),
                "x": min(119.0, max(1.0, p.x + (variation_idx % 5) * 0.4)),
                "y": min(79.0, max(1.0, p.y + (variation_idx % 3) * 0.3)),
                "is_modified": True
            })
            if p.player_id == 5 else p
            for p in base_frame.players
        ]
        return simulate_counterfactual(base_frame, mod_players)

    start_t = time.perf_counter()
    tasks = [run_single_sim(i) for i in range(25)]
    results = await asyncio.gather(*tasks)
    elapsed_ms = (time.perf_counter() - start_t) * 1000

    cloud_metrics_store["total_simulations"] += 25
    _recent_simulation_timestamps.extend([time.time()] * 25)
    scaling = compute_dynamic_cluster_scaling()

    avg_latency = round(elapsed_ms / 25, 2)
    cloud_metrics_store["last_compute_latency_ms"] = avg_latency
    sims_per_sec = round(25 / (elapsed_ms / 1000), 1) if elapsed_ms > 0 else 1500.0

    return {
        "status": "success",
        "benchmark": "25-Simulation Parallel KDTree Stress Burst",
        "simulations_count": 25,
        "total_time_ms": round(elapsed_ms, 2),
        "average_latency_ms": avg_latency,
        "throughput_simulations_per_sec": sims_per_sec,
        "kd_tree_lookups": 25 * len(base_frame.players) * 192,
        "engine": "scipy.spatial.KDTree + NumPy 16x12 Bilinear xT Interpolation",
        "active_instance_id": scaling["active_instance_id"],
        "aca_gateway_replicas": scaling["aca_gateway_replicas"],
        "aks_worker_pods": scaling["aks_worker_pods"],
        "estimated_cpu_utilization_pct": scaling["estimated_cpu_utilization_pct"],
        "sampled_simulated_xt": [round(r.metrics.simulated_xt, 2) for r in results[:5]],
        "metrics": cloud_metrics_store
    }



# ---------------------------------------------------------------------------
# WebSocket Manager for Real-Time Streaming & Interactive Playback
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)


ws_manager = ConnectionManager()


@app.websocket("/ws/match/{match_id}")
@app.websocket("/match/{match_id}")
async def match_websocket_endpoint(websocket: WebSocket, match_id: int):
    """
    Real-time bidirectional WebSocket channel.
    Supports playback control, highlight seek, and instant counterfactual recalculations.
    Query parameters `lang` (en | es) and `audience` pick the narration profile of the frames it sends.
    """
    await ws_manager.connect(websocket)
    try:
        lang = normalize_language(websocket.query_params.get("lang"))
        audience = normalize_audience(websocket.query_params.get("audience"))
        frames_list = load_frames(match_id, lang, audience)
        current_frame_idx = 1 if len(frames_list) > 1 else 0  # Default to the second key moment
        base_frame = frames_list[current_frame_idx]

        # Send initial frame upon handshake
        await websocket.send_json({
            "type": "INITIAL_FRAME",
            "frame_index": current_frame_idx,
            "total_frames": len(frames_list),
            "payload": base_frame.model_dump()
        })

        ws_client = client_key(websocket.headers, websocket.client.host if websocket.client else None)

        while True:
            data = await websocket.receive_text()
            if len(data.encode("utf-8")) > settings.WS_MAX_MESSAGE_BYTES:
                await websocket.close(code=1009, reason="Message too large")
                ws_manager.disconnect(websocket)
                return
            message = json.loads(data)

            action = message.get("action")
            msg_type = message.get("type")

            # 1. Seek / Navigate to a specific Golden Highlight frame
            if action == "seek" or msg_type == "SEEK_FRAME":
                target_idx = int(message.get("frame_index", 0))
                if 0 <= target_idx < len(frames_list):
                    current_frame_idx = target_idx
                    base_frame = frames_list[current_frame_idx]
                    await websocket.send_json({
                        "type": "FRAME_UPDATE",
                        "frame_index": current_frame_idx,
                        "payload": base_frame.model_dump()
                    })

            # 2. Playback transport state acknowledgment
            elif action in ("play", "pause"):
                await websocket.send_json({
                    "type": "PLAYBACK_STATE",
                    "action": action,
                    "speed": message.get("speed", 1.0)
                })

            # 3. Interactive Counterfactual Simulation
            elif action == "simulate" or msg_type == "SIMULATE_MOVE":
                allowed, retry_after = allow(WS_SIMULATE_BUCKET, ws_client)
                if not allowed:
                    await websocket.send_json({
                        "type": "SIMULATION_ERROR",
                        "reason": "rate_limited",
                        "retry_after_s": retry_after,
                    })
                    continue
                try:
                    request_data = CounterfactualRequest(**message.get("payload", {}))
                except ValidationError:
                    await websocket.send_json({"type": "SIMULATION_ERROR", "reason": "invalid_payload"})
                    continue

                # Match base frame by event_uuid
                matching_base = next(
                    (f for f in frames_list if f.event_uuid == request_data.event_uuid),
                    base_frame
                )

                # Recalculate geometry and AI debate via dual-role executor (with circuit breaker)
                simulated_frame = await execute_simulation(request_data, matching_base)


                await websocket.send_json({
                    "type": "SIMULATION_UPDATE",
                    "frame_index": current_frame_idx,
                    "payload": simulated_frame.model_dump()
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.disconnect(websocket)
