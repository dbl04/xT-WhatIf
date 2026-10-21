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
import { ProfileSwitcher } from "@/components/controls/ProfileSwitcher";
import { Button, IconButton, Kicker } from "@/components/ui/primitives";
import { useMatchEngine } from "@/hooks/useMatchEngine";
import { useBroadcastTTS } from "@/hooks/useBroadcastTTS";
import { getPresetsForFrame, TacticalPreset } from "@/lib/presets";
import { getMatchInfo } from "@/lib/match";
import { useI18n } from "@/lib/i18n";
import { PlayerNode } from "@/types/match";
import {
  Download,
  Columns2,
  Server,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const { language, audience, t } = useI18n();
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
  } = useMatchEngine({ language, audience });

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
    language,
    audience,
  });

  // Interaction, playback and modal state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isCloudTelemetryOpen, setIsCloudTelemetryOpen] = useState<boolean>(false);
  const [isDemoGuideOpen, setIsDemoGuideOpen] = useState<boolean>(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState<boolean>(false);
  const [isHudDrawerOpen, setIsHudDrawerOpen] = useState<boolean>(true);

  const pitchRef = useRef<TacticalPitch2DHandle | null>(null);

  // Contextual tactical presets for the current play
  const currentPresets = useMemo(
    () => getPresetsForFrame(currentFrame, t),
    [currentFrame, t]
  );

  // Moves players and simulates in one go. triggerSimulation receives the moved players
  // explicitly because its `frames` snapshot does not include updates from this same tick.
  const applyMovesAndSimulate = (players: PlayerNode[]) => {
    const moved = players.filter((p) => p.is_modified);
    moved.forEach((p) => updatePlayerPosition(p.player_id, p.x, p.y));
    triggerSimulation(moved);
  };

  const applyPreset = (preset: TacticalPreset) => {
    setIsPlaying(false);
    applyMovesAndSimulate(
      currentFrame.players.map((p) =>
        p.player_id === preset.playerId
          ? {
              ...p,
              x: preset.targetX,
              y: preset.targetY,
              original_x: p.original_x ?? p.x,
              original_y: p.original_y ?? p.y,
              is_modified: true,
            }
          : p
      )
    );
  };

  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleDragStart = () => {
    if (isPlaying) {
      setIsPlaying(false);
    }
  };

  // Stable props for the export modal: it regenerates the PNG whenever these change.
  const getPitchSvg = useCallback(() => pitchRef.current?.getSvgElement() ?? null, []);
  const exportMatchInfo = useMemo(
    () => ({
      minute: currentFrame.minute,
      second: currentFrame.second,
      eventType: currentFrame.event_type,
      isCounterfactual: currentFrame.is_counterfactual_mode,
      possessionTeam: currentFrame.possession_team,
      fixture: getMatchInfo(currentFrame),
    }),
    [
      currentFrame.minute,
      currentFrame.second,
      currentFrame.event_type,
      currentFrame.is_counterfactual_mode,
      currentFrame.possession_team,
      currentFrame.match_info,
    ]
  );

  const fixture = getMatchInfo(currentFrame);
  const teamShortNames = { home: fixture.home.short_name, away: fixture.away.short_name };

  const clock = `${currentFrame.minute}:${String(currentFrame.second).padStart(2, "0")}`;
  const isLive = connectionMode === "live";

  return (
    <main className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-ink text-fg">
      {/* 1. Top Broadcast Bar */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          {/* Wordmark */}
          <div className="flex items-baseline gap-0.5 font-display text-[22px] font-extrabold uppercase leading-none tracking-tight">
            <span className="text-fg">xT</span>
            <span className="text-signal-green">/</span>
            <span className="text-fg">WhatIf</span>
          </div>

          <span className="hidden h-6 w-px bg-line-strong sm:block" />

          {/* Scorebug */}
          <div className="hidden shrink-0 items-stretch overflow-hidden rounded-[3px] border border-line-strong font-display text-sm font-bold uppercase leading-none tracking-wide sm:flex">
            <span className="flex items-center gap-1.5 bg-fg px-2.5 text-ink">
              <span className="h-2.5 w-1 bg-team-home" />
              {fixture.home.short_name}
            </span>
            <span className="flex min-w-[58px] items-center justify-center bg-ink-800 px-2.5 tabular-nums text-fg">
              {clock}
            </span>
            <span className="flex items-center gap-1.5 bg-fg px-2.5 text-ink">
              {fixture.away.short_name}
              <span className="h-2.5 w-1 bg-ink" />
            </span>
          </div>

          <div className="hidden min-w-0 flex-col xl:flex">
            <Kicker>{fixture.competition} · {t("header.syntheticData")}</Kicker>
            <span className="truncate text-xs text-fg-muted">
              {fixture.venue ? `${fixture.venue} · ` : ""}
              {fixture.home.name} v {fixture.away.name} ·{" "}
              <span className={currentFrame.is_counterfactual_mode ? "text-signal-green" : "text-fg"}>
                {currentFrame.is_counterfactual_mode ? t("header.simulated") : t("header.original")}
              </span>
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            onClick={() => setIsHudDrawerOpen((prev) => !prev)}
            title={t("nav.panelTitle")}
            className={isHudDrawerOpen ? "text-fg" : undefined}
          >
            {isHudDrawerOpen ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            )}
            <span className="hidden xl:inline">{t("nav.panel")}</span>
          </Button>

          <Button
            variant="ghost"
            onClick={() => setIsScenarioModalOpen(true)}
            title={t("nav.compareTitle")}
          >
            <Columns2 className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t("nav.compare")}</span>
          </Button>

          <Button
            variant="ghost"
            onClick={() => setIsCloudTelemetryOpen(true)}
            className="hidden md:inline-flex"
            title={t("nav.infraTitle")}
          >
            <Server className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t("nav.infra")}</span>
          </Button>

          <IconButton
            onClick={() => setIsDemoGuideOpen(true)}
            className="hidden sm:inline-flex"
            title={t("nav.guideTitle")}
            aria-label={t("nav.guideAria")}
          >
            <HelpCircle className="h-4 w-4" />
          </IconButton>

          <span className="mx-2 hidden h-5 w-px bg-line-strong sm:block" />

          <ProfileSwitcher />

          <span className="mx-2 hidden h-5 w-px bg-line-strong sm:block" />

          <span
            className="mr-2 hidden items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted sm:inline-flex"
            title={isLive ? t("nav.liveTitle") : t("nav.offlineTitle")}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-signal-green" : "bg-fg-subtle"}`} />
            {isLive ? "Live" : "Offline"}
          </span>

          <Button variant="primary" onClick={() => setIsExportModalOpen(true)} title={t("nav.exportTitle")}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("nav.export")}</span>
          </Button>
        </nav>
      </header>

      {/* 2. Main Stadium Viewport */}
      <div className="relative z-10 flex h-full w-full flex-1 items-center justify-center overflow-hidden p-2 sm:p-4">
        {/* Width capped so the 3:2 pitch fits the viewport height. 10.5rem = header (56px)
            + stage padding (32px) + pitch top bar (45px) + footer (33px) + frame border (2px);
            those bars have fixed heights and never wrap. */}
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ maxWidth: "min(1720px, calc((100vh - 10.5rem) * 1.5))" }}
        >
          <TacticalPitch2D
            ref={pitchRef}
            teamShortNames={teamShortNames}
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

        {/* 3. Tactical Dock (Top-Left) */}
        <div className="pointer-events-none absolute left-4 top-4 z-30 flex w-full max-w-[340px] flex-col">
          <AnimatePresence>
            {isHudDrawerOpen && (
              <motion.aside
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="pointer-events-auto flex max-h-[calc(100vh-15rem)] flex-col overflow-y-auto rounded-lg border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
              >
                {/* Quick scenarios */}
                <section className="border-b border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Kicker>{t("dock.quickScenarios")}</Kicker>
                    <span className="font-mono text-[10px] text-fg-subtle">
                      {currentPresets.length}
                    </span>
                  </div>
                  <ul className="-mx-1 flex flex-col">
                    {currentPresets.map((preset) => (
                      <li key={preset.id}>
                        <button
                          onClick={() => applyPreset(preset)}
                          className="group flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
                        >
                          <span className="truncate">{preset.label}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-signal-green" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Auto-Coach */}
                <section className="border-b border-line p-3">
                  <AutoCoachPanel
                    currentFrame={currentFrame}
                    onApplyOptimalDefense={applyMovesAndSimulate}
                    onResetDefense={() => resetSimulation()}
                  />
                </section>

                {/* xT metrics */}
                <section className="p-3">
                  <XtDeltaPanel
                    teamShortNames={teamShortNames}
                    metrics={currentFrame.metrics}
                    isCounterfactualMode={currentFrame.is_counterfactual_mode}
                    onReset={() => {
                      setIsPlaying(false);
                      resetSimulation();
                    }}
                  />
                </section>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Lower-Third */}
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
          clockLabel={clock}
          eventType={currentFrame.event_type}
        />

        {/* 5. Transport Dock */}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 mx-auto flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-5xl">
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

      {/* Modals */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        getSvgElement={getPitchSvg}
        matchInfo={exportMatchInfo}
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
        onRestoreScenario={(restoredFrame) => applyMovesAndSimulate(restoredFrame.players)}
      />
    </main>
  );
}
