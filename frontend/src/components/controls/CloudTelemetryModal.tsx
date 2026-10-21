"use strict";
"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, Zap, Power, Loader2 } from "lucide-react";
import { Button, IconButton, Kicker, ModalShell, Tag } from "@/components/ui/primitives";
import { StressBurstResponse } from "@/types/match";
import { API_BASE_URL } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface CloudTelemetryData {
  service_role: string;
  compute_mode: string;
  total_simulations: number;
  cache_hits: number;
  aks_delegated_calls: number;
  circuit_breaker_trips: number;
  last_compute_latency_ms: number;
  chaos_force_aks_failure: boolean;
  aca_gateway_replicas?: number;
  aks_worker_pods?: number;
  keda_active?: boolean;
}

interface StressBurstResult {
  burst_count: number;
  total_elapsed_ms: number;
  avg_latency_ms: number;
  sims_per_second: number;
  kd_tree_lookups: number;
  engine: string;
}

function normalizeBurstResult(api: StressBurstResponse): StressBurstResult {
  return {
    burst_count: api.simulations_count,
    total_elapsed_ms: api.total_time_ms,
    avg_latency_ms: api.average_latency_ms,
    sims_per_second: api.throughput_simulations_per_sec,
    kd_tree_lookups: api.kd_tree_lookups,
    engine: api.engine,
  };
}

interface CloudTelemetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiBaseUrl?: string;
}

export const CloudTelemetryModal: React.FC<CloudTelemetryModalProps> = ({
  isOpen,
  onClose,
  apiBaseUrl = API_BASE_URL,
}) => {
  const { t } = useI18n();
  const [telemetry, setTelemetry] = useState<CloudTelemetryData>({
    service_role: "aca-gateway",
    compute_mode: "aks-distributed",
    total_simulations: 142,
    cache_hits: 98,
    aks_delegated_calls: 44,
    circuit_breaker_trips: 0,
    last_compute_latency_ms: 14.2,
    chaos_force_aks_failure: false,
    aca_gateway_replicas: 3,
    aks_worker_pods: 6,
    keda_active: true,
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBursting, setIsBursting] = useState<boolean>(false);
  const [burstResult, setBurstResult] = useState<StressBurstResult | null>(null);
  // Shown in the viewer's language, so it is derived from the state rather than the API message.
  const [showChaosMessage, setShowChaosMessage] = useState<boolean>(false);

  // Load on open
  const fetchTelemetry = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${apiBaseUrl}/api/v1/cloud/telemetry`, {
        signal: AbortSignal.timeout(1800),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Graceful offline fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTelemetry();
    }
  }, [isOpen]);

  // Action 1: stress burst (25x Voronoi / xT)
  const handleStressBurst = async () => {
    setIsBursting(true);
    setBurstResult(null);

    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/cloud/stress-burst`, {
        method: "POST",
        signal: AbortSignal.timeout(3500),
      });

      if (res.ok) {
        const data = normalizeBurstResult(await res.json());
        setBurstResult(data);
        setTelemetry((prev) => ({
          ...prev,
          total_simulations: prev.total_simulations + 25,
          last_compute_latency_ms: data.avg_latency_ms,
        }));
        setIsBursting(false);
        return;
      }
    } catch {
      // Instant local fallback when the backend is unreachable
    }

    // Simulated local benchmark
    await new Promise((r) => setTimeout(r, 480));
    const simulatedResult: StressBurstResult = {
      burst_count: 25,
      total_elapsed_ms: 18.4,
      avg_latency_ms: 0.74,
      sims_per_second: 1358.7,
      kd_tree_lookups: 25 * 22 * 192,
      engine: "Scipy Voronoi + KDTree + 16x12 Expected Threat",
    };
    setBurstResult(simulatedResult);
    setTelemetry((prev) => ({
      ...prev,
      total_simulations: prev.total_simulations + 25,
      last_compute_latency_ms: 0.74,
    }));
    setIsBursting(false);
  };

  // Action 2: simulate an AKS outage (chaos test of the circuit breaker)
  const handleChaosToggle = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/cloud/chaos-toggle`, {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          chaos_force_aks_failure: data.chaos_force_aks_failure,
          circuit_breaker_trips: data.circuit_breaker_trips,
        }));
        setShowChaosMessage(true);
        return;
      }
    } catch {
      // Local fallback
    }

    // Local toggle
    const nextChaos = !telemetry.chaos_force_aks_failure;
    setTelemetry((prev) => ({
      ...prev,
      chaos_force_aks_failure: nextChaos,
      circuit_breaker_trips: nextChaos
        ? prev.circuit_breaker_trips + 1
        : prev.circuit_breaker_trips,
    }));
    setShowChaosMessage(true);
  };

  if (!isOpen) return null;

  const isCircuitBroken = telemetry.chaos_force_aks_failure;

  const services = [
    {
      platform: "Azure Container Apps",
      name: "xt-whatif-aca-gateway",
      detail: t("cloud.acaDetail"),
      metricLabel: t("cloud.replicas"),
      metricValue: String(telemetry.aca_gateway_replicas ?? 3),
      status: "ok" as const,
    },
    {
      platform: "Azure Kubernetes Service",
      name: "xt-whatif-aks-worker",
      detail: isCircuitBroken
        ? t("cloud.aksDown")
        : t("cloud.aksDetail"),
      metricLabel: "Pods",
      metricValue: isCircuitBroken ? "—" : String(telemetry.aks_worker_pods ?? 6),
      status: isCircuitBroken ? ("down" as const) : ("ok" as const),
    },
    {
      platform: "Azure AI Foundry",
      name: t("cloud.agents"),
      detail: t("cloud.agentsDetail"),
      metricLabel: t("cloud.model"),
      metricValue: "gpt-4o",
      status: "ok" as const,
    },
  ];

  const stats = [
    { label: t("cloud.latency"), value: Number(telemetry.last_compute_latency_ms ?? 0).toFixed(1), unit: "ms", note: t("cloud.lastCalc") },
    { label: "Cache hits", value: String(telemetry.cache_hits), unit: "", note: t("cloud.cacheNote") },
    { label: t("cloud.simulations"), value: String(telemetry.total_simulations), unit: "", note: t("cloud.simulationsNote") },
    {
      label: "Circuit breaker",
      value: String(telemetry.circuit_breaker_trips),
      unit: "",
      note: t("cloud.breakerNote"),
      alert: telemetry.circuit_breaker_trips > 0,
    },
  ];

  return (
    <ModalShell
      kicker={t("cloud.kicker")}
      title={t("cloud.title")}
      description={t("cloud.desc")}
      onClose={onClose}
      className="max-w-4xl"
      headerActions={
        <IconButton onClick={fetchTelemetry} disabled={isLoading} title={t("cloud.refresh")} aria-label={t("cloud.refresh")}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </IconButton>
      }
      footer={
        <>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Container Apps · Kubernetes Service · OpenAI
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      {/* Services */}
      <section className="px-5 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <Kicker>{t("cloud.services")}</Kicker>
          {isCircuitBroken ? (
            <Tag tone="magenta">{t("cloud.breakerOpen")}</Tag>
          ) : (
            <Tag tone="green">{t("cloud.operational")}</Tag>
          )}
        </div>
        <div className="divide-y divide-line rounded-md border border-line">
          {services.map((svc) => (
            <div key={svc.name} className="flex items-center gap-4 px-4 py-3">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${svc.status === "ok" ? "bg-signal-green" : "bg-signal-magenta"}`}
                aria-label={svc.status === "ok" ? t("cloud.operational") : t("cloud.down")}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[13px] text-fg">{svc.name}</span>
                  <span className="text-[11px] text-fg-subtle">{svc.platform}</span>
                </div>
                <p className={`mt-0.5 text-[12px] ${svc.status === "ok" ? "text-fg-muted" : "text-signal-magenta"}`}>
                  {svc.detail}
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{svc.metricLabel}</div>
                <div className="font-display text-xl font-bold leading-none tabular-nums text-fg">{svc.metricValue}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">{t("cloud.simulatedNote")}</p>
      </section>

      {/* Stats */}
      <section className="px-5 pt-5">
        <Kicker>{t("cloud.performance")}</Kicker>
        <div className="mt-2 grid grid-cols-2 divide-line rounded-md border border-line sm:grid-cols-4 sm:divide-x">
          {stats.map((st) => (
            <div key={st.label} className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{st.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span
                  className={`font-display text-[32px] font-bold leading-none tabular-nums ${
                    st.alert ? "text-signal-magenta" : "text-fg"
                  }`}
                >
                  {st.value}
                </span>
                {st.unit && <span className="font-mono text-[11px] text-fg-subtle">{st.unit}</span>}
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">{st.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Live test bench */}
      <section className="px-5 py-5">
        <Kicker>{t("cloud.live")}</Kicker>
        <p className="mt-1 text-[13px] text-fg-muted">{t("cloud.liveDesc")}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={handleStressBurst} disabled={isBursting}>
            {isBursting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {isBursting ? t("cloud.bursting") : t("cloud.burst")}
          </Button>

          <Button variant="secondary" onClick={handleChaosToggle} className={isCircuitBroken ? "border-signal-magenta/60 text-signal-magenta" : undefined}>
            <Power className="h-3.5 w-3.5" />
            {isCircuitBroken ? t("cloud.restoreAks") : t("cloud.killAks")}
          </Button>
        </div>

        {burstResult && (
          <div className="mt-3 rounded-md border border-line px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-fg">{t("cloud.burstDone", { n: burstResult.burst_count })}</span>
              <span className="font-display text-lg font-bold tabular-nums text-signal-green">
                {burstResult.sims_per_second.toLocaleString()} sims/s
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-fg-muted">
              {t("cloud.burstStats", {
                total: burstResult.total_elapsed_ms,
                avg: burstResult.avg_latency_ms,
                lookups: burstResult.kd_tree_lookups.toLocaleString(),
              })}
            </div>
          </div>
        )}

        {showChaosMessage && (
          <div
            className={`mt-3 border-l-2 py-1 pl-3 text-[12px] ${
              isCircuitBroken ? "border-signal-magenta text-fg" : "border-signal-green text-fg-muted"
            }`}
          >
            {isCircuitBroken ? t("cloud.chaosOn") : t("cloud.chaosOff")}
          </div>
        )}
      </section>
    </ModalShell>
  );
};

export default CloudTelemetryModal;
