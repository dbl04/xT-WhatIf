"use strict";
"use client";

import React from "react";
import { TacticalMetrics } from "@/types/match";
import { RotateCcw, Download } from "lucide-react";
import { IconButton, Kicker, Tag } from "@/components/ui/primitives";

interface XtDeltaPanelProps {
  metrics: TacticalMetrics;
  isCounterfactualMode?: boolean;
  onReset?: () => void;
  onExportReport?: () => void;
}

const Stat: React.FC<{
  label: string;
  value: string;
  tone?: "default" | "green" | "magenta" | "muted";
}> = ({ label, value, tone = "default" }) => {
  const tones = {
    default: "text-fg",
    muted: "text-fg-muted",
    green: "text-signal-green",
    magenta: "text-signal-magenta",
  } as const;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className={`font-display text-[32px] font-bold leading-none tabular-nums ${tones[tone]}`}>
        {value}
      </span>
    </div>
  );
};

export const XtDeltaPanel: React.FC<XtDeltaPanelProps> = ({
  metrics,
  isCounterfactualMode = false,
  onReset,
  onExportReport,
}) => {
  const isPositive = metrics.xt_delta >= 0;
  // Δ rounds to 0.00 on the untouched play (and on moves that change nothing): stay neutral.
  const isUnchanged = !isCounterfactualMode || Math.abs(metrics.xt_delta) < 0.005;
  const homePct = Math.max(0, Math.min(100, metrics.space_control_home_pct));
  const passPct = Math.max(0, Math.min(100, metrics.pass_completion_prob));

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Kicker>Expected Threat</Kicker>
        <div className="flex items-center gap-1">
          {isCounterfactualMode ? <Tag tone="green">Simulado</Tag> : <Tag>Real</Tag>}
          {isCounterfactualMode && onReset && (
            <IconButton size="sm" onClick={onReset} title="Restablecer jugada real" aria-label="Restablecer jugada real">
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {onExportReport && (
            <IconButton size="sm" onClick={onExportReport} title="Exportar informe táctico" aria-label="Exportar informe">
              <Download className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Main figures */}
      <div className="grid grid-cols-3 divide-x divide-line">
        <div className="pr-3">
          <Stat label="xT real" value={metrics.original_xt.toFixed(2)} tone="muted" />
        </div>
        <div className="px-3">
          <Stat label="xT simulado" value={metrics.simulated_xt.toFixed(2)} />
        </div>
        <div className="pl-3">
          <Stat
            label="Δ xT"
            value={isPositive ? `+${metrics.xt_delta.toFixed(2)}` : metrics.xt_delta.toFixed(2)}
            tone={isUnchanged ? "default" : isPositive ? "green" : "magenta"}
          />
        </div>
      </div>
      <p className="-mt-1 text-[11px] text-fg-subtle">
        {isUnchanged
          ? "Sin cambios respecto a la jugada real."
          : isPositive
          ? "El cambio genera más peligro."
          : "El cambio reduce el peligro."}
      </p>

      {/* Territorial split */}
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wider text-fg-subtle">Control territorial</span>
        </div>
        <div className="flex h-1.5 w-full overflow-hidden rounded-[1px] bg-white/[0.06]">
          <div className="h-full bg-team-home transition-[width] duration-300" style={{ width: `${homePct}%` }} />
          <div className="h-full flex-1 bg-team-away/80" />
        </div>
        <div className="flex items-center justify-between font-display text-sm font-semibold uppercase tabular-nums">
          <span className="text-team-home">ARG {homePct.toFixed(1)}%</span>
          <span className="text-fg-muted">{(100 - homePct).toFixed(1)}% FRA</span>
        </div>
      </div>

      {/* Pass probability */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wider text-fg-subtle">Probabilidad de pase</span>
          <span className="font-display text-sm font-semibold tabular-nums text-fg">{passPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-[1px] bg-white/[0.06]">
          <div className="h-full bg-fg transition-[width] duration-300" style={{ width: `${passPct}%` }} />
        </div>
      </div>
    </div>
  );
};

export default XtDeltaPanel;
