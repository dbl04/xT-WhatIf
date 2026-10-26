"""
Cloud Telemetry Service for xT-WhatIf Azure Container Apps & Azure Monitor.
Queries Azure Monitor / KEDA metrics for real running replica count and holds the
in-process cluster telemetry and chaos-engineering circuit breaker state shared by
the gateway, the live match service, and the AKS delegation client.
Falls back gracefully to simulated telemetry when offline or unauthenticated.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger("xt_whatif.cloud_telemetry")
# The Azure SDKs log every HTTP request and token fetch at INFO; keep only their warnings.
logging.getLogger("azure").setLevel(logging.WARNING)

# Cached telemetry result to avoid throttling Azure Monitor API limits
_cached_telemetry: Optional[Dict[str, Any]] = None
_cached_time: float = 0.0
_CACHE_TTL_SECONDS: float = 15.0


def get_active_instance_id() -> str:
    """Returns active container/pod replica identifier from environment."""
    return os.getenv("CONTAINER_APP_REPLICA_NAME") or os.getenv("HOSTNAME", "local-dev-node")


# Cloud Telemetry state & Chaos Engineering store for Microsoft Hackathon Demo
cloud_metrics_store: Dict[str, Any] = {
    "service_role": settings.SERVICE_ROLE if settings.SERVICE_ROLE != "standalone" else "aca-gateway",
    "compute_mode": "aks-distributed" if settings.AKS_WORKER_URL else "local-in-process",
    "active_instance_id": get_active_instance_id(),
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
_chaos_enabled_at: Optional[float] = None


def _get_chaos_enabled_at() -> Optional[float]:
    main_mod = sys.modules.get("app.main")
    if main_mod is not None and "_chaos_enabled_at" in main_mod.__dict__:
        return main_mod.__dict__["_chaos_enabled_at"]
    return _chaos_enabled_at


def _set_chaos_enabled_at(value: Optional[float]) -> None:
    global _chaos_enabled_at
    _chaos_enabled_at = value
    main_mod = sys.modules.get("app.main")
    if main_mod is not None:
        main_mod.__dict__["_chaos_enabled_at"] = value


def record_simulation_activity(count: int = 1) -> None:
    """Records `count` simulation/optimisation events in the sliding throughput window."""
    now = time.time()
    if count <= 1:
        _recent_simulation_timestamps.append(now)
    else:
        _recent_simulation_timestamps.extend([now] * count)


def _expire_chaos_if_due() -> None:
    """Chaos mode is shared by every visitor of the demo: switch it off automatically."""
    if not cloud_metrics_store["chaos_force_aks_failure"]:
        _set_chaos_enabled_at(None)
        return
    enabled_at = _get_chaos_enabled_at()
    if enabled_at is None:
        _set_chaos_enabled_at(time.time())
    elif time.time() - enabled_at >= settings.CHAOS_AUTO_RESET_SECONDS:
        cloud_metrics_store["chaos_force_aks_failure"] = False
        _set_chaos_enabled_at(None)
        logger.info("Chaos mode auto-reset after %ss.", settings.CHAOS_AUTO_RESET_SECONDS)


def chaos_seconds_remaining() -> Optional[int]:
    enabled_at = _get_chaos_enabled_at()
    if enabled_at is None or not cloud_metrics_store["chaos_force_aks_failure"]:
        return None
    return max(0, int(settings.CHAOS_AUTO_RESET_SECONDS - (time.time() - enabled_at)))


def set_chaos_mode(force: Optional[bool] = None) -> bool:
    """Updates the chaos flag and increments circuit_breaker_trips when chaos is turned on."""
    _expire_chaos_if_due()
    if force is not None:
        cloud_metrics_store["chaos_force_aks_failure"] = bool(force)
    else:
        cloud_metrics_store["chaos_force_aks_failure"] = not cloud_metrics_store["chaos_force_aks_failure"]

    if cloud_metrics_store["chaos_force_aks_failure"]:
        cloud_metrics_store["circuit_breaker_trips"] += 1
        _set_chaos_enabled_at(time.time())
    else:
        _set_chaos_enabled_at(None)
    return bool(cloud_metrics_store["chaos_force_aks_failure"])


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
        aks_pods: Any = "0 (Unreachable - Circuit Breaker Active)"
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


def get_aca_gateway_replicas(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    app_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Queries Azure Monitor metrics to read the actual number of running replicas
    of our Azure Container App gateway (xt-whatif-aca-gateway).

    Uses `azure-identity` (DefaultAzureCredential) and `azure-mgmt-monitor`.
    If the query fails (e.g., running locally without credentials, missing libraries,
    network failure, or empty metrics), it gracefully falls back to returning:
    {"replicas": 1, "simulated": True}
    """
    global _cached_telemetry, _cached_time

    now = time.time()
    if _cached_telemetry is not None and (now - _cached_time) < _CACHE_TTL_SECONDS:
        return _cached_telemetry

    try:
        from azure.identity import DefaultAzureCredential
        from azure.mgmt.monitor import MonitorManagementClient
    except ImportError:
        logger.debug("azure-identity or azure-mgmt-monitor not installed; using simulated telemetry.")
        fallback: Dict[str, Any] = {"replicas": 1, "simulated": True}
        _cached_telemetry = fallback
        _cached_time = now
        return fallback

    sub_id = subscription_id or os.getenv("AZURE_SUBSCRIPTION_ID")
    rg = resource_group or os.getenv("AZURE_RESOURCE_GROUP", os.getenv("RESOURCE_GROUP", "rg-xtwhatif-hackathon"))
    aca_app = app_name or os.getenv("ACA_GATEWAY_NAME", "xt-whatif-aca-gateway")

    if not sub_id:
        # Normal when running locally, so it stays out of the default log output.
        logger.debug("AZURE_SUBSCRIPTION_ID is not set; using simulated telemetry.")
        fallback = {"replicas": 1, "simulated": True}
        _cached_telemetry = fallback
        _cached_time = now
        return fallback

    try:
        credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
        client = MonitorManagementClient(credential, sub_id)

        resource_uri = (
            f"/subscriptions/{sub_id}/resourceGroups/{rg}"
            f"/providers/Microsoft.App/containerApps/{aca_app}"
        )

        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(minutes=5)
        # UTC with a "Z" suffix: the "+" of "+00:00" is not URL-encoded by the SDK, reaches Azure
        # Monitor as a space and the query is rejected (400, invalid time interval).
        iso = "%Y-%m-%dT%H:%M:%SZ"
        timespan = f"{start_time.strftime(iso)}/{end_time.strftime(iso)}"

        metrics_data = client.metrics.list(
            resource_uri=resource_uri,
            timespan=timespan,
            interval="PT1M",
            # REST name of the metric the portal shows as "Replica Count".
            metricnames="Replicas",
            aggregation="Average,Maximum",
        )

        for item in metrics_data.value:
            for timeseries in item.timeseries:
                for point in reversed(timeseries.data):
                    if point.average is not None:
                        val = int(round(point.average))
                        res: Dict[str, Any] = {"replicas": max(1, val), "simulated": False}
                        _cached_telemetry = res
                        _cached_time = now
                        return res
                    if point.maximum is not None:
                        val = int(round(point.maximum))
                        res = {"replicas": max(1, val), "simulated": False}
                        _cached_telemetry = res
                        _cached_time = now
                        return res

        logger.warning("Azure Monitor returned no Replicas data for %s; using simulated telemetry.", aca_app)
        fallback = {"replicas": 1, "simulated": True}
        _cached_telemetry = fallback
        _cached_time = now
        return fallback

    except Exception as e:
        logger.warning("Azure Monitor query failed (fallback to simulated): %s", e)
        fallback = {"replicas": 1, "simulated": True}
        _cached_telemetry = fallback
        _cached_time = now
        return fallback
