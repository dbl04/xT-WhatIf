"""
Distributed AKS Worker client for the live match's moment Validator.

When a candidate event arrives during the live match and `settings.AKS_WORKER_URL` is configured
(on a non-worker role), `analyse_moment_distributed` offloads the two independent searches
(`optimize(frame, "attack")` and `optimize(frame, "defend")`) in parallel to the AKS worker pool
via `POST /api/v1/game/optimize`.

If chaos mode is active, or either request times out, fails, returns a non-200 status, or
returns an invalid payload, the circuit breaker trips and falls back to in-process execution
(`asyncio.to_thread(analyse_moment, frame)`), producing identical `MomentReport` values.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx

from app.core.config import settings
from app.schemas.match_contract import MatchFramePayload
from app.services.cloud_telemetry import (
    _expire_chaos_if_due,
    cloud_metrics_store,
    record_simulation_activity,
)
from app.services.game_engine import (
    MIN_MARGIN,
    MomentReport,
    Optimum,
    analyse_moment,
    build_moment_report,
)

logger = logging.getLogger("xtwhatif.aks_client")


async def analyse_moment_distributed(
    frame: MatchFramePayload,
    min_margin: float = MIN_MARGIN,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> MomentReport:
    """
    Runs the moment Validator across the AKS worker pool (attack + defend in parallel) when
    `AKS_WORKER_URL` is set, with an automatic circuit-breaker fallback to local in-process compute.
    """
    _expire_chaos_if_due()

    if not settings.AKS_WORKER_URL or settings.SERVICE_ROLE == "aks-worker":
        return await asyncio.to_thread(analyse_moment, frame, min_margin)

    cloud_metrics_store["total_simulations"] += 1
    record_simulation_activity()

    if cloud_metrics_store["chaos_force_aks_failure"]:
        cloud_metrics_store["circuit_breaker_trips"] += 1
        logger.warning(
            "CHAOS INJECTION ACTIVE: Simulating AKS Worker outage -> Circuit Breaker tripped to local moment analysis"
        )
    else:
        target_endpoint = f"{settings.AKS_WORKER_URL.rstrip('/')}/api/v1/game/optimize"
        headers = {"X-Worker-Token": settings.AKS_WORKER_TOKEN} if settings.AKS_WORKER_TOKEN else {}
        frame_json = frame.model_dump(mode="json")
        cloud_metrics_store["aks_delegated_calls"] += 1
        start_remote = time.perf_counter()
        try:
            async with httpx.AsyncClient(
                timeout=settings.AKS_ANALYSE_TIMEOUT_S,
                transport=transport,
            ) as client:
                atk_resp, def_resp = await asyncio.gather(
                    client.post(target_endpoint, json={"frame": frame_json, "mode": "attack"}, headers=headers),
                    client.post(target_endpoint, json={"frame": frame_json, "mode": "defend"}, headers=headers),
                )
            if atk_resp.status_code != 200 or def_resp.status_code != 200:
                raise RuntimeError(
                    f"AKS worker returned HTTP attack={atk_resp.status_code}, defend={def_resp.status_code}"
                )
            attack = Optimum.from_dict(atk_resp.json())
            defend = Optimum.from_dict(def_resp.json())
            if attack.mode != "attack" or defend.mode != "defend":
                raise ValueError(f"Unexpected optimum modes: {attack.mode!r}, {defend.mode!r}")
            remote_latency = (time.perf_counter() - start_remote) * 1000
            cloud_metrics_store["last_compute_latency_ms"] = round(remote_latency, 2)
            return build_moment_report(frame, attack, defend, min_margin=min_margin)
        except Exception as exc:
            cloud_metrics_store["circuit_breaker_trips"] += 1
            logger.warning(
                "AKS Worker moment optimisation failed (%s: %s). Tripping Circuit Breaker to local in-process compute.",
                exc.__class__.__name__,
                exc,
            )

    start_local = time.perf_counter()
    report = await asyncio.to_thread(analyse_moment, frame, min_margin)
    local_latency = (time.perf_counter() - start_local) * 1000
    cloud_metrics_store["last_compute_latency_ms"] = round(local_latency, 2)
    return report
