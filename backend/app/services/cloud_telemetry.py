"""
Cloud Telemetry Service for xT-WhatIf Azure Container Apps & Azure Monitor.
Queries Azure Monitor / KEDA metrics for real running replica count.
Falls back gracefully to simulated telemetry when offline or unauthenticated.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("xt_whatif.cloud_telemetry")
# The Azure SDKs log every HTTP request and token fetch at INFO; keep only their warnings.
logging.getLogger("azure").setLevel(logging.WARNING)

# Cached telemetry result to avoid throttling Azure Monitor API limits
_cached_telemetry: Optional[Dict[str, Any]] = None
_cached_time: float = 0.0
_CACHE_TTL_SECONDS: float = 15.0


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
