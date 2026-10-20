"use strict";
"use client";

import React, { useState } from "react";
import { MatchFramePayload, PlayerNode } from "@/types/match";
import {
  X,
  Pin,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Activity,
  Award,
  RotateCcw,
  Layers,
} from "lucide-react";

export interface SavedScenario {
  id: string;
  label: string;
  timestamp: string;
  frame: MatchFramePayload;
}

export interface ScenarioComparatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFrame: MatchFramePayload;
  onRestoreScenario: (frame: MatchFramePayload) => void;
}

function calculateTotalDisplacement(players: PlayerNode[]): number {
  let total = 0;
  for (const p of players) {
    if (p.is_modified && p.original_x != null && p.original_y != null) {
      total += Math.hypot(p.x - p.original_x, p.y - p.original_y);
    }
  }
  return Math.round(total * 10) / 10;
}

function MiniPitchPreview({ frame }: { frame: MatchFramePayload }) {
  return (
    <div className="w-full h-24 bg-slate-900/90 rounded-xl border border-slate-800 overflow-hidden relative">
      <svg
        viewBox="0 0 120 80"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Pitch boundary and markings */}
        <rect
          x="0"
          y="0"
          width="120"
          height="80"
          fill="#064e3b"
          fillOpacity="0.3"
          stroke="#10b981"
          strokeWidth="0.5"
          strokeOpacity="0.4"
        />
        <line
          x1="60"
          y1="0"
          x2="60"
          y2="80"
          stroke="#10b981"
          strokeWidth="0.4"
          strokeOpacity="0.4"
        />
        <circle
          cx="60"
          cy="40"
          r="9.15"
          fill="none"
          stroke="#10b981"
          strokeWidth="0.4"
          strokeOpacity="0.4"
        />
        <rect
          x="102"
          y="18"
          width="18"
          height="44"
          fill="none"
          stroke="#10b981"
          strokeWidth="0.4"
          strokeOpacity="0.4"
        />

        {/* Players */}
        {frame.players.map((p) => {
          const isHome = p.team === "home";
          return (
            <circle
              key={p.player_id}
              cx={p.x}
              cy={p.y}
              r={p.is_modified ? 2.4 : 1.4}
              fill={
                p.is_modified
                  ? "#f59e0b"
                  : isHome
                  ? "#38bdf8"
                  : "#f43f5e"
              }
              stroke={p.is_modified ? "#ffffff" : "none"}
              strokeWidth="0.6"
            />
          );
        })}

        {/* Ball */}
        <circle
          cx={frame.ball_x}
          cy={frame.ball_y}
          r="1.6"
          fill="#ffffff"
          stroke="#000000"
          strokeWidth="0.4"
        />
      </svg>
    </div>
  );
}

export const ScenarioComparatorModal: React.FC<ScenarioComparatorModalProps> = ({
  isOpen,
  onClose,
  currentFrame,
  onRestoreScenario,
}) => {
  const [scenarioA, setScenarioA] = useState<SavedScenario | null>(null);
  const [scenarioB, setScenarioB] = useState<SavedScenario | null>(null);

  if (!isOpen) return null;

  const handlePinScenarioA = () => {
    setScenarioA({
      id: "scenario-a",
      label: "Escenario A",
      timestamp: new Date().toLocaleTimeString(),
      frame: JSON.parse(JSON.stringify(currentFrame)),
    });
  };

  const handlePinScenarioB = () => {
    setScenarioB({
      id: "scenario-b",
      label: "Escenario B",
      timestamp: new Date().toLocaleTimeString(),
      frame: JSON.parse(JSON.stringify(currentFrame)),
    });
  };

  // Evaluation of trade-off: delta reduction in threat per meter of displacement
  const getEfficiencyRatio = (sc: SavedScenario | null) => {
    if (!sc) return 0;
    const disp = calculateTotalDisplacement(sc.frame.players);
    const reduction = sc.frame.metrics.original_xt - sc.frame.metrics.simulated_xt;
    if (disp <= 0.05) return 0;
    return Math.round((reduction / disp) * 1000) / 1000;
  };

  const effA = getEfficiencyRatio(scenarioA);
  const effB = getEfficiencyRatio(scenarioB);

  let verdict = "Fija ambos escenarios para calcular el balance táctico óptimo.";
  if (scenarioA && scenarioB) {
    if (effA > effB) {
      verdict = `🏆 El Escenario A ofrece mayor eficiencia táctica (${effA > 0 ? "+" : ""}${effA} ΔxT/m): mayor reducción de peligro con menor desgaste físico.`;
    } else if (effB > effA) {
      verdict = `🏆 El Escenario B ofrece mayor eficiencia táctica (${effB > 0 ? "+" : ""}${effB} ΔxT/m): mejor bloqueo de carril interior respecto a los metros recorridos.`;
    } else {
      verdict = "⚖️ Ambos escenarios presentan un perfil de riesgo/recompensa idéntico.";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Split Lab: Comparador 1v1 de Escenarios</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                  Head-to-Head
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Guarda 2 hipótesis contrafácticas y evalúa la relación Reducción de Peligro vs. Esfuerzo Físico
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar to Pin current state */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-900/40 border-b border-slate-800/60 text-xs">
          <span className="text-slate-400 font-medium">
            Estado actual en pizarra: {currentFrame.players.filter((p) => p.is_modified).length} jugadores modificados
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePinScenarioA}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/60 font-semibold transition active:scale-95"
            >
              <Pin className="w-3.5 h-3.5" />
              <span>📌 Fijar como Escenario A</span>
            </button>
            <button
              onClick={handlePinScenarioB}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950 hover:bg-purple-900 text-purple-300 border border-purple-700/60 font-semibold transition active:scale-95"
            >
              <Pin className="w-3.5 h-3.5" />
              <span>📌 Fijar como Escenario B</span>
            </button>
          </div>
        </div>

        {/* Comparison Grid: Base vs A vs B */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 overflow-y-auto">
          {/* Column 1: Base Reality */}
          <div className="flex flex-col gap-3 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                1. Realidad Base (StatsBomb)
              </span>
              <span className="text-[10px] font-mono text-slate-500">Oficial</span>
            </div>

            <MiniPitchPreview frame={currentFrame} />

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Amenaza Base (xT):</span>
                <span className="font-mono font-bold text-slate-200">
                  {currentFrame.metrics.original_xt.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Control Voronoi:</span>
                <span className="font-mono font-bold text-slate-200">
                  {currentFrame.metrics.space_control_home_pct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Éxito de Pase:</span>
                <span className="font-mono font-bold text-slate-200">
                  {currentFrame.metrics.pass_completion_prob.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Desplazamiento:</span>
                <span className="font-mono font-bold text-slate-500">0.0 m</span>
              </div>
            </div>
          </div>

          {/* Column 2: Scenario A */}
          <div className="flex flex-col gap-3 p-4 rounded-2xl bg-cyan-950/20 border border-cyan-800/40 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                2. Escenario A
              </span>
              {scenarioA && (
                <span className="text-[10px] font-mono text-cyan-500">
                  {scenarioA.timestamp}
                </span>
              )}
            </div>

            {scenarioA ? (
              <>
                <MiniPitchPreview frame={scenarioA.frame} />
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-cyan-900/40">
                    <span className="text-slate-400">Amenaza (xT):</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {scenarioA.frame.metrics.simulated_xt.toFixed(3)} (
                      {scenarioA.frame.metrics.xt_delta > 0 ? "+" : ""}
                      {scenarioA.frame.metrics.xt_delta.toFixed(3)})
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-cyan-900/40">
                    <span className="text-slate-400">Control Voronoi:</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {scenarioA.frame.metrics.space_control_home_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-cyan-900/40">
                    <span className="text-slate-400">Éxito de Pase:</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {scenarioA.frame.metrics.pass_completion_prob.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Desplazamiento Total:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {calculateTotalDisplacement(scenarioA.frame.players)} m
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onRestoreScenario(scenarioA.frame);
                    onClose();
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition active:scale-95"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar en Pizarra</span>
                </button>
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
                <Pin className="w-6 h-6 mb-2 opacity-40" />
                <p>Mueve jugadores en la pizarra y pulsa &ldquo;Fijar como Escenario A&rdquo;.</p>
              </div>
            )}
          </div>

          {/* Column 3: Scenario B */}
          <div className="flex flex-col gap-3 p-4 rounded-2xl bg-purple-950/20 border border-purple-800/40 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-400">
                3. Escenario B
              </span>
              {scenarioB && (
                <span className="text-[10px] font-mono text-purple-500">
                  {scenarioB.timestamp}
                </span>
              )}
            </div>

            {scenarioB ? (
              <>
                <MiniPitchPreview frame={scenarioB.frame} />
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-purple-900/40">
                    <span className="text-slate-400">Amenaza (xT):</span>
                    <span className="font-mono font-bold text-purple-300">
                      {scenarioB.frame.metrics.simulated_xt.toFixed(3)} (
                      {scenarioB.frame.metrics.xt_delta > 0 ? "+" : ""}
                      {scenarioB.frame.metrics.xt_delta.toFixed(3)})
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-purple-900/40">
                    <span className="text-slate-400">Control Voronoi:</span>
                    <span className="font-mono font-bold text-purple-300">
                      {scenarioB.frame.metrics.space_control_home_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-purple-900/40">
                    <span className="text-slate-400">Éxito de Pase:</span>
                    <span className="font-mono font-bold text-purple-300">
                      {scenarioB.frame.metrics.pass_completion_prob.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Desplazamiento Total:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {calculateTotalDisplacement(scenarioB.frame.players)} m
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onRestoreScenario(scenarioB.frame);
                    onClose();
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition active:scale-95"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar en Pizarra</span>
                </button>
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
                <Pin className="w-6 h-6 mb-2 opacity-40" />
                <p>Mueve a otros jugadores y pulsa &ldquo;Fijar como Escenario B&rdquo;.</p>
              </div>
            )}
          </div>
        </div>

        {/* Verdict Bar */}
        <div className="px-6 py-4 bg-slate-900/80 border-t border-slate-800 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div className="flex-1 text-xs">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400">
              Veredicto de Eficiencia Contrafáctica (ΔxT / Desgaste Físico)
            </div>
            <p className="text-slate-200 font-medium mt-0.5">{verdict}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
