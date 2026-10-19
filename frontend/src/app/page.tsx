"use client";

import React from "react";
import { TacticalPitch2D } from "@/components/pitch/TacticalPitch2D";
import { AgentDebateFeed } from "@/components/agents/AgentDebateFeed";
import { XtDeltaPanel } from "@/components/metrics/XtDeltaPanel";
import { PlaybackBar } from "@/components/controls/PlaybackBar";
import { useMatchSocket } from "@/hooks/useMatchSocket";
import { Ghost, Sparkles, Cpu, Zap, Activity } from "lucide-react";

export default function DashboardPage() {
  const {
    currentFrame,
    isConnected,
    isThinking,
    highlightedPlayerIds,
    setHighlightedPlayerIds,
    updatePlayerPosition,
    triggerSimulation,
    resetSimulation,
  } = useMatchSocket();

  // Escenarios contrafactuales preconfigurados
  const applyPresetScenario = (type: string) => {
    if (type === "kounde_wide") {
      // Escenario exacto del contrato de Gemini 4 Argon: Koundé a (88.0, 25.0)
      updatePlayerPosition(5, 88.0, 25.0);
      triggerSimulation();
    } else if (type === "dimaria_deep") {
      // Di María rompe al espacio
      updatePlayerPosition(11, 102.0, 14.0);
      triggerSimulation();
    } else if (type === "messi_inside") {
      // Messi progresa al carril central
      updatePlayerPosition(10, 84.0, 44.0);
      triggerSimulation();
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/20">
            <Ghost className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-slate-100">
                xT-WhatIf
              </h1>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                StatsBomb 360 (120x80)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Argentina vs Francia • Final Copa del Mundo 2022 (Minuto {currentFrame.minute}:{String(currentFrame.second).padStart(2, "0")})
            </p>
          </div>
        </div>

        {/* Status & Connection Badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/70 border border-slate-700/60 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300 font-medium">
              {isConnected ? "FastAPI WebSocket Activo" : "Modo Offline (Mock Oficial)"}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Multi-Agent Swarm: Dr. Voronoi vs Míster Bianchi</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <div className="flex-1 p-6 max-w-[1700px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Pitch, Playback, and Quick What-If Scenarios (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {/* Quick Preset Buttons Bar */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Simulaciones Rápidas:
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => applyPresetScenario("kounde_wide")}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition"
              >
                Koundé Retrasado (88.0, 25.0)
              </button>
              <button
                onClick={() => applyPresetScenario("dimaria_deep")}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition"
              >
                Di María Ruptura Profunda
              </button>
              <button
                onClick={() => applyPresetScenario("messi_inside")}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition"
              >
                Messi Interior
              </button>
            </div>
          </div>

          {/* Interactive 2D Pitch (120x80) */}
          <TacticalPitch2D
            players={currentFrame.players}
            ballX={currentFrame.ball_x}
            ballY={currentFrame.ball_y}
            ballEndX={currentFrame.ball_end_x}
            ballEndY={currentFrame.ball_end_y}
            highlightedPlayerIds={highlightedPlayerIds}
            onPlayerMove={updatePlayerPosition}
            onSimulationTrigger={triggerSimulation}
          />

          {/* Playback Controls */}
          <PlaybackBar
            minute={currentFrame.minute}
            second={currentFrame.second}
            eventType={currentFrame.event_type}
            isCounterfactualMode={currentFrame.is_counterfactual_mode}
            onResetSimulation={resetSimulation}
          />

          {/* Telemetry Panel */}
          <XtDeltaPanel
            metrics={currentFrame.metrics}
            isCounterfactualMode={currentFrame.is_counterfactual_mode}
            onReset={resetSimulation}
          />
        </div>

        {/* Right Column: Multi-Agent AI Swarm Debate Cabin (4 cols) */}
        <div className="lg:col-span-4 flex flex-col h-full min-h-[600px]">
          <AgentDebateFeed
            messages={currentFrame.agent_debate}
            isThinking={isThinking}
            onHoverPlayers={setHighlightedPlayerIds}
          />
        </div>
      </div>
    </main>
  );
}
