"use strict";
"use client";

import React, { useState, useRef, useMemo, useCallback } from "react";
import { TacticalPitch2D, TacticalPitch2DHandle } from "@/components/pitch/TacticalPitch2D";
import { XtDeltaPanel } from "@/components/metrics/XtDeltaPanel";
import { PlaybackBar } from "@/components/controls/PlaybackBar";
import { ExportReportModal } from "@/components/controls/ExportReportModal";
import { CloudTelemetryModal } from "@/components/controls/CloudTelemetryModal";
import { DemoGuideModal } from "@/components/controls/DemoGuideModal";
import { AutoCoachPanel } from "@/components/controls/AutoCoachPanel";
import { ScenarioComparatorModal } from "@/components/metrics/ScenarioComparatorModal";
import { BroadcastCommentatorCard } from "@/components/audio/BroadcastCommentatorCard";
import { useMatchEngine } from "@/hooks/useMatchEngine";
import { useBroadcastTTS } from "@/hooks/useBroadcastTTS";
import { getPresetsForFrame, TacticalPreset } from "@/lib/presets";
import {
  Ghost,
  Cpu,
  Zap,
  Camera,
  Cloud,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const {
    frames,
    currentFrameIndex,
    currentFrame,
    connectionMode,
    isThinking,
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

  // Audio broadcast hook
  const handleActiveSpeakerChange = useCallback(
    (_role: "data_scientist" | "classic_coach" | null, pIds: number[]) => {
      setHighlightedPlayerIds(pIds);
    },
    [setHighlightedPlayerIds]
  );

  const tts = useBroadcastTTS({
    messages: currentFrame.agent_debate,
    onActiveSpeakerChange: handleActiveSpeakerChange,
  });

  // Estados de interacción, cinemática y modales
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isCloudTelemetryOpen, setIsCloudTelemetryOpen] = useState<boolean>(false);
  const [isDemoGuideOpen, setIsDemoGuideOpen] = useState<boolean>(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState<boolean>(false);
  const [isHudDrawerOpen, setIsHudDrawerOpen] = useState<boolean>(true);

  const pitchRef = useRef<TacticalPitch2DHandle | null>(null);

  // Presets tácticos dinámicos contextualizados por jugada
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
    if (isPlaying) {
      setIsPlaying(false);
    }
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none flex flex-col">
      {/* 1. Top Broadcast Navbar (z-30) */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0 z-30">
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
                Premier League Broadcast HUD (120x80)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Argentina vs Francia • Final Copa del Mundo 2022 (Minuto {currentFrame.minute}:{String(currentFrame.second).padStart(2, "0")})
            </p>
          </div>
        </div>

        {/* Action Controls & Navigation */}
        <div className="flex items-center gap-2">
          {/* Toggle HUD Drawer */}
          <button
            onClick={() => setIsHudDrawerOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition active:scale-95 ${
              isHudDrawerOpen
                ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title="Mostrar / Ocultar HUD Táctico & Auto-Coach"
          >
            <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isHudDrawerOpen ? "Ocultar HUD" : "🧠 Panel Táctico"}</span>
          </button>

          {/* Botón: Guía Rápida Demo 60s */}
          <button
            onClick={() => setIsDemoGuideOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold transition shadow-sm active:scale-95"
            title="Cómo probar xT-WhatIf en 60 segundos"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>🎯 Guía 60s</span>
          </button>

          {/* Botón: Split Lab Comparador 1v1 */}
          <button
            onClick={() => setIsScenarioModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/50 text-purple-300 text-xs font-bold transition shadow-sm active:scale-95"
            title="Abrir Split Lab para comparar hipótesis contrafácticas 1v1"
          >
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>⚖️ Split Lab 1v1</span>
          </button>

          {/* Botón: Telemetría Cloud AKS / ACA */}
          <button
            onClick={() => setIsCloudTelemetryOpen(true)}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/50 text-cyan-300 text-xs font-bold transition shadow-sm active:scale-95"
            title="Abrir Panel de Telemetría en Vivo de Azure Container Apps y Kubernetes"
          >
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            <span>☁️ Cloud Telemetry</span>
          </button>

          {/* Botón: Exportar Informe Táctico */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition shadow-sm active:scale-95"
            title="Generar tarjeta ejecutiva táctica en alta resolución 2K PNG"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400" />
            <span>📸 Exportar</span>
          </button>

          {/* Estado de Conexión Dual-Mode */}
          {connectionMode === "live" ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/70 border border-emerald-700/80 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-200 font-bold font-mono text-[11px]">LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/70 border border-amber-700/80 text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-200 font-bold font-mono text-[11px]">OFFLINE</span>
            </div>
          )}
        </div>
      </header>

      {/* 2. Main Full-Screen Stadium Viewport */}
      <div className="flex-1 w-full h-full relative z-10 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
        {/* Cancha 120x80 a pantalla completa panorámica */}
        <div className="w-full h-full max-w-[1720px] flex items-center justify-center">
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

        {/* 3. Floating Collapsible HUD Drawer (Top-Left) */}
        <div className="absolute top-4 left-4 z-30 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          <AnimatePresence>
            {isHudDrawerOpen && (
              <motion.div
                initial={{ opacity: 0, x: -30, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -30, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-auto flex flex-col gap-2.5 p-3 rounded-2xl bg-slate-950/85 backdrop-blur-md border border-slate-800/80 shadow-2xl"
              >
                {/* Presets Rápidos */}
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      Simulaciones Rápidas:
                    </span>
                  </div>
                  <button
                    onClick={() => setIsHudDrawerOpen(false)}
                    className="p-1 rounded-lg text-slate-500 hover:text-slate-300"
                    title="Minimizar HUD"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {currentPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="px-2.5 py-1 rounded-xl text-[11px] font-medium bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/60 hover:border-amber-500/50 hover:text-amber-200 transition active:scale-95 shadow-sm"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Auto-Coach AI Optimizer */}
                <AutoCoachPanel
                  currentFrame={currentFrame}
                  onApplyOptimalDefense={(optimizedPlayers) => {
                    optimizedPlayers.forEach((p) => {
                      if (p.is_modified) {
                        updatePlayerPosition(p.player_id, p.x, p.y);
                      }
                    });
                    triggerSimulation();
                  }}
                  onResetDefense={() => resetSimulation()}
                />

                {/* Métricas xT en Formato Compacto */}
                <XtDeltaPanel
                  metrics={currentFrame.metrics}
                  isCounterfactualMode={currentFrame.is_counterfactual_mode}
                  onReset={() => {
                    setIsPlaying(false);
                    resetSimulation();
                  }}
                  onExportReport={() => setIsExportModalOpen(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Lower-Third Televisivo Emergente (BroadcastCommentatorCard) */}
        <BroadcastCommentatorCard
          messages={currentFrame.agent_debate}
          activeSpeakingRole={tts.activeSpeaker}
          isSpeaking={tts.isPlaying}
          isSimulating={isThinking}
          highlightedPlayerIds={highlightedPlayerIds}
          onHighlightPlayers={setHighlightedPlayerIds}
          onPlaySingleMessage={tts.playSingleMessage}
          onPlayFullDebate={tts.play}
          onStopAudio={tts.stop}
        />

        {/* 5. Bottom Transport Dock (PlaybackBar + Audio) */}
        <div className="absolute bottom-2 inset-x-0 mx-auto z-30 flex justify-center px-4 pointer-events-none">
          <div className="w-full max-w-4xl bg-slate-950/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-2 shadow-2xl pointer-events-auto">
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
        </div>
      </div>

      {/* Modales */}
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

      <CloudTelemetryModal
        isOpen={isCloudTelemetryOpen}
        onClose={() => setIsCloudTelemetryOpen(false)}
      />

      <DemoGuideModal
        isOpen={isDemoGuideOpen}
        onClose={() => setIsDemoGuideOpen(false)}
      />

      <ScenarioComparatorModal
        isOpen={isScenarioModalOpen}
        onClose={() => setIsScenarioModalOpen(false)}
        currentFrame={currentFrame}
        onRestoreScenario={(restoredFrame) => {
          restoredFrame.players.forEach((p) => {
            if (p.is_modified) {
              updatePlayerPosition(p.player_id, p.x, p.y);
            }
          });
          triggerSimulation();
        }}
      />
    </main>
  );
}
