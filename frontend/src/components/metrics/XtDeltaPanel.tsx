"use strict";
"use client";

import React from "react";
import { TacticalMetrics } from "@/types/match";
import { ArrowUpRight, ArrowDownRight, Activity, Percent, RotateCcw, Target, Zap } from "lucide-react";

interface XtDeltaPanelProps {
  metrics: TacticalMetrics;
  isCounterfactualMode?: boolean;
  onReset?: () => void;
}

export const XtDeltaPanel: React.FC<XtDeltaPanelProps> = ({
  metrics,
  isCounterfactualMode = false,
  onReset,
}) => {
  const isPositive = metrics.xt_delta >= 0;

  return (
    <div className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-bold tracking-wider uppercase text-slate-200">
            Telemetría Contrafactual xT (StatsBomb 120x80)
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {isCounterfactualMode ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-400 border border-amber-600/70 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              Modo Contrafactual Activo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300">
              Jugada Real (Base)
            </span>
          )}
          {isCounterfactualMode && onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-pink-300 bg-slate-900 hover:bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition"
              title="Restablecer jugada real"
            >
              <RotateCcw className="w-3 h-3" />
              Restablecer
            </button>
          )}
        </div>
      </div>

      {/* Métricas Principales */}
      <div className="grid grid-cols-3 gap-3">
        {/* original_xt */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
            xT Real (Base)
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold font-mono text-slate-200">
              {metrics.original_xt.toFixed(2)}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">xT</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block">StatsBomb 360 Event</span>
        </div>

        {/* simulated_xt */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <span className="text-[10px] font-medium text-pink-400 uppercase tracking-wider block">
            xT Simulado
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold font-mono text-pink-300">
              {metrics.simulated_xt.toFixed(2)}
            </span>
            <span className="text-[11px] text-pink-500 font-mono">xT</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block">Tras reposicionar</span>
        </div>

        {/* xt_delta */}
        <div
          className={`p-3 rounded-xl border ${
            isPositive
              ? "bg-emerald-950/20 border-emerald-800/40"
              : "bg-rose-950/20 border-rose-800/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              Δ xT Neto
            </span>
            {isPositive ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span
              className={`text-2xl font-bold font-mono ${
                isPositive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {isPositive ? `+${metrics.xt_delta.toFixed(2)}` : metrics.xt_delta.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            {isPositive ? "Ganancia de Peligro" : "Colapso de Peligro"}
          </span>
        </div>
      </div>

      {/* Fila Secundaria: Dominio Espacial & Probabilidad de Pase */}
      <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/60">
        {/* Dominio Espacial */}
        <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/60">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Percent className="w-3 h-3 text-blue-400" /> Dominio Espacial Local
            </span>
            <span className="font-mono font-bold text-slate-200">
              {metrics.space_control_home_pct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.min(100, metrics.space_control_home_pct)}%` }}
            />
          </div>
        </div>

        {/* Probabilidad de Éxito de Pase */}
        <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/60">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Target className="w-3 h-3 text-emerald-400" /> Probabilidad de Pase
            </span>
            <span className="font-mono font-bold text-emerald-400">
              {metrics.pass_completion_prob.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.min(100, metrics.pass_completion_prob)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default XtDeltaPanel;
