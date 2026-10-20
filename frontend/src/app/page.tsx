"use strict";
"use client";

import React, { useState, useRef, useMemo } from "react";
import { TacticalPitch2D, TacticalPitch2DHandle } from "@/components/pitch/TacticalPitch2D";
import { AgentDebateFeed } from "@/components/agents/AgentDebateFeed";
import { XtDeltaPanel } from "@/components/metrics/XtDeltaPanel";
import { PlaybackBar } from "@/components/controls/PlaybackBar";
import { ExportReportModal } from "@/components/controls/ExportReportModal";
import { CloudTelemetryModal } from "@/components/controls/CloudTelemetryModal";
import { DemoGuideModal } from "@/components/controls/DemoGuideModal";
import { useMatchEngine } from "@/hooks/useMatchEngine";
import { getPresetsForFrame, TacticalPreset } from "@/lib/presets";
import { Ghost, Cpu, Zap, Camera, Cloud, HelpCircle, Sparkles } from "lucide-react";

export default function DashboardPage() {
  const {
    frames,
    currentFrameIndex,
    currentFrame,
    connectionMode,
    isThinking,
    thinkingMessage,
    highlightedPlayerIds,
    setHighlightedPlayerIds,
    hoveredPlayerId,
    setHoveredPlayerId,
    selectFrameIndex,
    updatePlayerPosition,
    onPlayerDrop,
    triggerSimulation,
    resetSimulation,
  } = useMatchEngine();

  // Estados de interacción, cinemática y modales
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isCloudTelemetryOpen, setIsCloudTelemetryOpen] = useState<boolean>(false);
  const [isDemoGuideOpen, setIsDemoGuideOpen] = useState<boolean>(false);
  const pitchRef = useRef<TacticalPitch2DHandle | null>(null);

  // Presets tácticos dinámicos contextualizados por jugada (Entregable 4)
  const currentPresets = useMemo(
    () => getPresetsForFrame(currentFrame),
    [currentFrame]
  );

  const applyPreset = (preset: TacticalPreset) => {
    setIsPlaying(false);
    updatePlayerPosition(preset.playerId, preset.targetX, preset.targetY);
    triggerSimulation();
  };

  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleDragStart = () => {
    // Pausa instantánea de la animación al tocar a cualquier jugador
    if (isPlaying) {
      setIsPlaying(false);
    }
  };

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col select-none">
      {/* Top Navigation Bar - Broadcast Pro Dark Mode */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md px-6 py-2.5 flex items-center justify-between shrink-0 z-40">
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
            <p className="text-[11px] text-slate-400">
              Argentina vs Francia • Final Copa del Mundo 2022 (Minuto {currentFrame.minute}:{String(currentFrame.second).padStart(2, "0")})
            </p>
          </div>
        </div>

        {/* Action Controls, Cloud Telemetry & Connection Badges */}
        <div className="flex items-center gap-2.5">
          {/* Botón 1: Guía Rápida Demo 60s */}
          <button
            onClick={() => setIsDemoGuideOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold transition shadow-sm active:scale-95"
            title="Cómo probar xT-WhatIf en 60 segundos"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>🎯 Guía Demo 60s</span>
          </button>

          {/* Botón 2: Telemetría Cloud AKS / ACA (Microsoft Azure) */}
          <button
            onClick={() => setIsCloudTelemetryOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/50 text-cyan-300 text-xs font-bold transition shadow-sm shadow-blue-950/50 active:scale-95"
            title="Abrir Panel de Telemetría en Vivo de Azure Container Apps y Kubernetes"
          >
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            <span>☁️ Telemetría AKS / ACA</span>
          </button>

          {/* Botón 3: Exportar Informe Táctico */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition shadow-sm active:scale-95"
            title="Generar tarjeta ejecutiva táctica en alta resolución 2K PNG"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400" />
            <span>📸 Exportar Informe</span>
          </button>

          {/* Estado de Conexión Dual-Mode */}
          {connectionMode === "live" ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/70 border border-emerald-700/80 text-xs shadow-md shadow-emerald-950/40">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
              <span className="text-emerald-200 font-bold font-mono">
                🟢 LIVE BACKEND
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/70 border border-amber-700/80 text-xs shadow-md shadow-amber-950/40">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-200 font-bold font-mono">
                🟡 OFFLINE DEMO
              </span>
            </div>
          )}

          <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Multi-Agent Swarm</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Grid - Full Screen Optimized */}
      <div className="flex-1 p-4 max-w-[1800px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden min-h-0">
        {/* Left Column: Pitch, Playback Bar, Preset Buttons, Telemetry (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
          {/* Quick Preset Buttons Bar - Contextualized by Highlight (Entregable 4) */}
          <div className="flex flex-wrap items-center justify-between p-2.5 rounded-2xl bg-slate-900/70 border border-slate-800 shrink-0 gap-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Simulaciones Rápidas:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currentPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/60 hover:border-amber-500/50 hover:text-amber-200 transition active:scale-95 shadow-sm"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive 2D Pitch con Capas Tácticas, Animación Cinemática y Anillo de Inercia */}
          <div className="shrink-0">
            <TacticalPitch2D
              ref={pitchRef}
              players={currentFrame.players}
              ballX={currentFrame.ball_x}
              ballY={currentFrame.ball_y}
              ballEndX={currentFrame.ball_end_x}
              ballEndY={currentFrame.ball_end_y}
              metrics={currentFrame.metrics}
              isCounterfactualMode={currentFrame.is_counterfactual_mode}
              isPlaying={isPlaying}
              playbackSpeed={playbackSpeed}
              highlightedPlayerIds={highlightedPlayerIds}
              selectedPlayerId={hoveredPlayerId}
              onHoverPlayer={setHoveredPlayerId}
              onClickPlayer={(id) =>
                setHoveredPlayerId(id === hoveredPlayerId ? null : id)
              }
              onPlayerMove={updatePlayerPosition}
              onSimulationTrigger={onPlayerDrop}
              onAnimationEnd={() => setIsPlaying(false)}
              onDragStart={handleDragStart}
            />
          </div>

          {/* Playback Bar con Match Moment Selector y Cinemática */}
          <div className="shrink-0">
            <PlaybackBar
              frames={frames}
              currentFrameIndex={currentFrameIndex}
              onSelectFrameIndex={(idx) => {
                setIsPlaying(false);
                selectFrameIndex(idx);
              }}
              minute={currentFrame.minute}
              second={currentFrame.second}
              eventType={currentFrame.event_type}
              isCounterfactualMode={currentFrame.is_counterfactual_mode}
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onResetSimulation={() => {
                setIsPlaying(false);
                resetSimulation();
              }}
              onSpeedChange={(s) => setPlaybackSpeed(s)}
            />
          </div>

          {/* Panel de Telemetría xT con Botón de Exportación */}
          <div className="shrink-0">
            <XtDeltaPanel
              metrics={currentFrame.metrics}
              isCounterfactualMode={currentFrame.is_counterfactual_mode}
              onReset={() => {
                setIsPlaying(false);
                resetSimulation();
              }}
              onExportReport={() => setIsExportModalOpen(true)}
            />
          </div>
        </div>

        {/* Right Column: Cabina de Debate Multiagente con Sincronización Inversa (4 cols) */}
        <div className="lg:col-span-4 flex flex-col min-h-0 h-full overflow-hidden">
          <AgentDebateFeed
            messages={currentFrame.agent_debate}
            isThinking={isThinking}
            thinkingMessage={thinkingMessage}
            onHoverPlayers={setHighlightedPlayerIds}
            hoveredPlayerId={hoveredPlayerId}
            selectedPlayerId={hoveredPlayerId}
          />
        </div>
      </div>

      {/* Modal 1: Exportación del Reporte Táctico (Entregable 3) */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        getSvgElement={() => pitchRef.current?.getSvgElement() ?? null}
        matchInfo={{
          minute: currentFrame.minute,
          second: currentFrame.second,
          eventType: currentFrame.event_type,
          isCounterfactual: currentFrame.is_counterfactual_mode,
          possessionTeam: currentFrame.possession_team,
        }}
        metrics={currentFrame.metrics}
        debateMessages={currentFrame.agent_debate}
      />

      {/* Modal 2: Telemetría Cloud en Vivo (ACA + AKS + Circuit Breaker) (Fase 4 Entregable 1) */}
      <CloudTelemetryModal
        isOpen={isCloudTelemetryOpen}
        onClose={() => setIsCloudTelemetryOpen(false)}
      />

      {/* Modal 3: Guía Rápida de Demostración 60s (Fase 4 Entregable 2) */}
      <DemoGuideModal
        isOpen={isDemoGuideOpen}
        onClose={() => setIsDemoGuideOpen(false)}
      />
    </main>
  );
}
