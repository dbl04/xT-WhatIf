"use strict";
"use client";

import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
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
import { OnboardingGate, useFanSession } from "@/components/onboarding/OnboardingGate";
import { FanBadge } from "@/components/onboarding/FanBadge";
import { ChallengeCard, ChallengeStrip, PlayMomentCard, type LiveDelivery } from "@/components/challenge/ChallengeCards";
import { Button, IconButton, Kicker } from "@/components/ui/primitives";
import { useMatchEngine } from "@/hooks/useMatchEngine";
import { useChallenge } from "@/hooks/useChallenge";
import { LIVE_API_URL } from "@/lib/api";
import { liveClockSeconds, useLiveMatch, type MomentReveal } from "@/hooks/useLiveMatch";
import { useRevealReplay } from "@/hooks/useRevealReplay";
import { LeaderboardCard, LiveStatusCard, MatchEndCard, RevealCard } from "@/components/live/LiveCards";
import { modeFor } from "@/lib/challenge";
import type { PitchChallenge } from "@/components/pitch/TacticalPitch2D";
import { useBroadcastTTS } from "@/hooks/useBroadcastTTS";
import { sfx } from "@/lib/sfx";
import { getPresetsForFrame, TacticalPreset } from "@/lib/presets";
import { getMatchInfo } from "@/lib/match";
import { useI18n } from "@/lib/i18n";
import { MatchFramePayload, PlayerNode } from "@/types/match";
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

/** Pre-match onboarding (profile → team) and then the live dashboard. */
export default function HomePage() {
  return (
    <OnboardingGate>
      <DashboardPage />
    </OnboardingGate>
  );
}

/** Reveal: the pass the optimum opens, from the ball to its receiver where the optimum leaves them. */
function revealPass(frame: MatchFramePayload, reveal: MomentReveal): PitchChallenge["optimumPass"] {
  const target = reveal.optimum_target_id;
  if (target == null) return undefined;
  const moved = reveal.optimum_moves.find((m) => m.player_id === target);
  const player = frame.players.find((p) => p.player_id === target);
  if (!moved && !player) return undefined;
  return {
    fromX: frame.ball_x,
    fromY: frame.ball_y,
    toX: moved?.x ?? player!.x,
    toY: moved?.y ?? player!.y,
    changed: reveal.base_target_id != null && reveal.base_target_id !== target,
  };
}

function DashboardPage() {
  const { language, audience, t } = useI18n();
  const {
    frames,
    currentFrameIndex,
    currentFrame,
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

  // ====================================================================
  // xT Live Challenge. In the live match, MOMENT_OPEN opens the challenge for everyone and
  // the moves go back as SUBMIT; "Play this moment" stays for practising the key moments.
  // ====================================================================
  const fanSession = useFanSession();
  const supportedSide = fanSession?.team ?? "home";
  const live = useLiveMatch({
    userId: fanSession?.identity.userId ?? "",
    nickname: fanSession?.identity.nickname ?? "",
    team: supportedSide,
    language,
    audience,
    enabled: !!fanSession,
  });
  const liveState = live.state;
  const [practising, setPractising] = useState(false);
  const liveAvailable = liveState.status === "live" || liveState.status === "ended";
  const isLiveView = liveAvailable && !practising && !!liveState.frame;

  const challenge = useChallenge({
    onSubmit: (submission) => {
      if (submission.auto) sfx.whistle();
      else sfx.confirm();
      const moment = liveState.moment;
      if (!moment || moment.frame.event_uuid !== submission.eventUuid) return; // practice: nothing to send
      // Only legal moves are sent: a player breaking a rule stays in place (the server would
      // reject the whole submission otherwise).
      const broken = new Set((challenge.state?.violations ?? []).map((v) => v.player_id));
      live.submit(moment.moment_id, submission.moves.filter((m) => !broken.has(m.player_id)));
    },
  });
  const challengeState = challenge.state;
  const inChallenge = challengeState !== null;
  // Delivery of the moves only matters on the live moment's board, not in practice.
  const liveDelivery: LiveDelivery | undefined =
    challengeState && liveState.moment?.frame.event_uuid === challengeState.baseFrame.event_uuid
      ? { status: liveState.delivery, reason: liveState.lastAck?.reason, reconnecting: liveState.reconnecting }
      : undefined;

  // MOMENT_OPEN → open the challenge on the server's moment (once per moment).
  const openedMomentRef = useRef<string | null>(null);
  const { open: openChallenge, submit: submitChallenge, close: closeChallenge } = challenge;
  useEffect(() => {
    const moment = liveState.moment;
    if (!isLiveView || !moment || openedMomentRef.current === moment.moment_id || liveState.reveal) return;
    openedMomentRef.current = moment.moment_id;
    setIsPlaying(false);
    tts.stop();
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
    sfx.whistle();
    openChallenge({
      frame: moment.frame,
      team: supportedSide,
      durationS: moment.window_s,
      deadline: liveState.momentDeadline ?? undefined,
      // Only the single live-match service knows the moments of the live match.
      previewBaseUrl: LIVE_API_URL,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveView, liveState.moment, liveState.reveal]);

  // MOMENT_CLOSED → whatever is on the board goes in now.
  useEffect(() => {
    if (isLiveView && challengeState?.status === "open" && liveState.momentDeadline != null && liveState.momentDeadline <= Date.now()) {
      submitChallenge(true);
    }
  }, [isLiveView, challengeState?.status, liveState.momentDeadline, submitChallenge]);

  // Countdown ticks over the last seconds of an open challenge.
  const secondsLeft = challenge.secondsLeft;
  useEffect(() => {
    if (challengeState?.status === "open" && secondsLeft > 0 && secondsLeft <= 10) sfx.tick(secondsLeft);
  }, [challengeState?.status, secondsLeft]);

  const continueAfterReveal = () => {
    live.dismissReveal();
    closeChallenge();
  };

  // Game clock between messages, and the action replayed on every new live event.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isLiveView) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLiveView]);
  useEffect(() => {
    if (isLiveView && !inChallenge && liveState.frameSeq > 0) setIsPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveState.frameSeq]);

  const startChallenge = () => {
    setIsPlaying(false);
    tts.stop();
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
    setIsHudDrawerOpen(true);
    sfx.whistle();
    challenge.open({ frame: currentFrame, team: supportedSide });
  };

  const { flashNotice } = challenge;
  const reveal =
    isLiveView && liveState.reveal && liveState.reveal.moment_id === liveState.moment?.moment_id ? liveState.reveal : null;
  // One sound per reveal: rising when the fan found (nearly) the best move.
  const revealSoundRef = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal || revealSoundRef.current === reveal.moment_id) return;
    revealSoundRef.current = reveal.moment_id;
    sfx.reveal(reveal.beat_machine || (reveal.your_score ?? 0) >= 900);
  }, [reveal]);
  const { drop: dropOnBoard } = challenge;
  // The drop sound only for a player who really left their spot (a plain tap moves nobody).
  const dropInChallenge = useCallback(
    (playerId: number) => {
      const dropped = challengeState?.players.find((p) => p.player_id === playerId);
      if (challengeState?.status === "open" && dropped?.is_modified) sfx.drop();
      dropOnBoard();
    },
    [challengeState, dropOnBoard]
  );
  const replay = useRevealReplay(reveal, challengeState?.baseFrame ?? null, challengeState?.players ?? null);
  const replayPassing = !!reveal && replay.passing;
  const endReplayPass = replay.endPass;
  const handleAnimationEnd = useCallback(() => {
    if (replayPassing) endReplayPass();
    else setIsPlaying(false);
  }, [replayPassing, endReplayPass]);

  // What the pitch shows: the live action, the challenge board, or the key moment being practised.
  const pitchFrame = challengeState ? challengeState.baseFrame : isLiveView && liveState.frame ? liveState.frame : currentFrame;
  const liveMatchInfo = liveState.matchInfo ?? getMatchInfo(currentFrame);
  const pitchChallenge = useMemo<PitchChallenge | null>(() => {
    if (!challengeState) return null;
    const violationLabels: Record<number, string> = {};
    challengeState.violations.forEach((v) => {
      violationLabels[v.player_id] ??= t(`challenge.rule.${v.rule}`).toUpperCase();
    });
    return {
      movableIds: challengeState.movableIds,
      maxRadius: challengeState.rules.max_radius_m,
      maxPlayers: challengeState.rules.max_players,
      offsideLineX: challengeState.rules.offside_line_x,
      locked: challengeState.status !== "open",
      violationLabels,
      onBlocked: (_id, reason) => {
        sfx.blocked();
        flashNotice(reason);
      },
      optimum: reveal
        ? reveal.optimum_moves.map((m) => {
            const from = challengeState.baseFrame.players.find((p) => p.player_id === m.player_id);
            return { ...m, fromX: from?.x ?? m.x, fromY: from?.y ?? m.y };
          })
        : undefined,
      optimumPass: reveal ? revealPass(challengeState.baseFrame, reveal) : undefined,
    };
  }, [challengeState, t, flashNotice, reveal]);

  const liveClock = Math.floor(liveClockSeconds(liveState, nowTick));
  const clock = isLiveView
    ? `${Math.floor(liveClock / 60)}:${String(liveClock % 60).padStart(2, "0")}`
    : `${currentFrame.minute}:${String(currentFrame.second).padStart(2, "0")}`;

  return (
    <main className="relative flex min-h-screen w-full select-none flex-col bg-ink text-fg lg:h-screen lg:overflow-hidden">
      {/* Below lg the floating broadcast panels would cover most of the pitch, so the stage turns
          into a scrolling column: pitch, transport, dock, pundits. lg and up keep the overlay. */}

      {/* 1. Top Broadcast Bar */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          {/* Wordmark */}
          <div className="flex items-baseline gap-0.5 font-display text-[22px] font-extrabold uppercase leading-none tracking-tight">
            <span className="text-fg">xT</span>
            <span className="text-signal-gain">/</span>
            <span className="text-fg">WhatIf</span>
          </div>

          <span className="hidden h-6 w-px bg-line-strong sm:block" />

          {/* Scorebug */}
          <div className="hidden shrink-0 items-stretch overflow-hidden rounded-[3px] border border-line-strong font-display text-sm font-bold uppercase leading-none tracking-wide sm:flex">
            <span className="flex items-center gap-1.5 bg-fg px-2.5 text-ink">
              <span className="h-2.5 w-1 bg-team-home" />
              {fixture.home.short_name}
            </span>
            {isLiveView && (
              <span className="flex items-center bg-ink-700 px-2 tabular-nums text-fg">
                {liveState.score.home}–{liveState.score.away}
              </span>
            )}
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
              <span className={currentFrame.is_counterfactual_mode ? "text-signal-gain" : "text-fg"}>
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

          <FanBadge />

          <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />

          <ProfileSwitcher />

          <span className="mx-2 hidden h-5 w-px bg-line-strong sm:block" />

          <Button variant="primary" onClick={() => setIsExportModalOpen(true)} title={t("nav.exportTitle")}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("nav.export")}</span>
          </Button>
        </nav>
      </header>

      {/* 2. Main Stadium Viewport */}
      <div className="relative z-10 flex w-full flex-1 flex-col gap-3 p-2 sm:p-4 lg:h-full lg:flex-row lg:items-center lg:justify-center lg:overflow-hidden">
        {/* Width capped so the 3:2 pitch fits the viewport height. 10.5rem = header (56px)
            + stage padding (32px) + pitch top bar (45px) + footer (33px) + frame border (2px);
            those bars have fixed heights and never wrap. */}
        <div
          className="order-1 flex w-full items-center justify-center self-center lg:h-full"
          style={{ maxWidth: "min(1720px, calc((100vh - 10.5rem) * 1.5))" }}
        >
          <TacticalPitch2D
            ref={pitchRef}
            teamShortNames={teamShortNames}
            players={replay.players ?? (challengeState ? challengeState.players : pitchFrame.players)}
            ballX={pitchFrame.ball_x}
            ballY={pitchFrame.ball_y}
            ballEndX={replayPassing ? replay.passTo?.x : pitchFrame.ball_end_x}
            ballEndY={replayPassing ? replay.passTo?.y : pitchFrame.ball_end_y}
            metrics={pitchFrame.metrics}
            isCounterfactualMode={!inChallenge && !isLiveView && currentFrame.is_counterfactual_mode}
            isPlaying={(isPlaying && !inChallenge) || replayPassing}
            challenge={pitchChallenge}
            // The live match can only be touched while a key moment is open.
            readOnly={isLiveView && !inChallenge}
            playbackSpeed={playbackSpeed}
            highlightedPlayerIds={highlightedPlayerIds}
            selectedPlayerId={hoveredPlayerId}
            onHoverPlayer={setHoveredPlayerId}
            onClickPlayer={(id) =>
              setHoveredPlayerId(id === hoveredPlayerId ? null : id)
            }
            // In a challenge the board belongs to useChallenge: no counterfactual simulation
            // or debate on drop (that is the reveal's job), only the preview arrow.
            onPlayerMove={inChallenge ? challenge.move : isLiveView ? () => {} : updatePlayerPosition}
            onSimulationTrigger={inChallenge ? dropInChallenge : isLiveView ? () => {} : onPlayerDrop}
            onAnimationEnd={handleAnimationEnd}
            onDragStart={handleDragStart}
          />
        </div>

        {/* 3. Tactical Dock (Top-Left) */}
        <div className="pointer-events-none order-3 flex w-full flex-col lg:absolute lg:left-4 lg:top-4 lg:z-30 lg:max-w-[340px]">
          {challengeState ? (
            /* Challenge open: only the challenge card, always visible on large screens (the
               compact strip replaces the transport dock below lg). Auto-Coach, quick scenarios
               and the xT readout are hidden: they would give the answer away. */
            <motion.aside
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              aria-label={t("challenge.kicker")}
              className={`pointer-events-auto flex-col rounded-lg lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm lg:flex ${reveal ? "flex" : "hidden"}`}
            >
              {reveal ? (
                <div className="p-3">
                  <RevealCard
                    reveal={reveal}
                    onContinue={continueAfterReveal}
                    view={replay.view}
                    onView={replay.setView}
                    onReplay={replay.replay}
                  />
                </div>
              ) : (
                <ChallengeCard
                  state={challengeState}
                  secondsLeft={challenge.secondsLeft}
                  notice={challenge.notice}
                  teamInfo={fanSession?.teamInfo}
                  onConfirm={() => challenge.submit(false)}
                  onReset={challenge.reset}
                  onLeave={challenge.close}
                  onHighlightPlayer={setHoveredPlayerId}
                  delivery={liveDelivery}
                />
              )}
            </motion.aside>
          ) : isLiveView ? (
            <motion.aside
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              aria-label={t("live.kicker")}
              className="pointer-events-auto flex flex-col rounded-lg lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
            >
              <section className="border-b border-line p-3">
                {liveState.matchEnd ? (
                  <MatchEndCard end={liveState.matchEnd} matchInfo={liveMatchInfo} />
                ) : (
                  <LiveStatusCard
                    live={liveState}
                    clockSeconds={liveClock}
                    matchInfo={liveMatchInfo}
                    onPractice={() => setPractising(true)}
                  />
                )}
              </section>
              <section className="p-3">
                <LeaderboardCard
                  leaderboard={liveState.leaderboard}
                  matchInfo={liveMatchInfo}
                  nickname={fanSession?.identity.nickname ?? ""}
                  team={supportedSide}
                />
              </section>
            </motion.aside>
          ) : (
          <AnimatePresence>
            {isHudDrawerOpen && (
              <motion.aside
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="pointer-events-auto flex flex-col rounded-lg lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
              >
                {liveAvailable && practising && (
                  <section className="border-b border-line p-3">
                    <Button variant="secondary" className="w-full" onClick={() => setPractising(false)}>
                      {t("live.backToLive")}
                    </Button>
                  </section>
                )}

                {/* xT Live Challenge entry */}
                <section className="border-b border-line p-3">
                  <PlayMomentCard
                    mode={modeFor(supportedSide, currentFrame)}
                    possessionTeam={fixture[currentFrame.possession_team]}
                    supportedTeam={fixture[supportedSide]}
                    onPlay={startChallenge}
                  />
                </section>

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
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-signal-gain" />
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
          )}
        </div>

        {/* 4. Lower-Third (hidden during a challenge: the pundits discuss the answer and the
            card would cover the challenge card on short screens) */}
        {!inChallenge && !isLiveView && <div className="order-4 lg:contents"><BroadcastCommentatorCard
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
        /></div>}

        {/* 5. Transport Dock */}
        <div className="pointer-events-none order-2 flex w-full flex-col items-center gap-3 lg:absolute lg:inset-x-0 lg:bottom-3 lg:z-30 lg:mx-auto lg:flex-row lg:justify-center lg:px-4">
          {challengeState && !reveal && (
            <div className="pointer-events-auto w-full max-w-xl lg:hidden">
              <ChallengeStrip
                state={challengeState}
                secondsLeft={challenge.secondsLeft}
                notice={challenge.notice}
                teamInfo={fanSession?.teamInfo}
                onConfirm={() => challenge.submit(false)}
                onReset={challenge.reset}
                onLeave={challenge.close}
                delivery={liveDelivery}
              />
            </div>
          )}
          <div className={`pointer-events-auto w-full max-w-5xl ${isLiveView ? "hidden" : challengeState ? "hidden lg:block" : ""}`}>
            <PlaybackBar
              frames={frames}
              currentFrameIndex={currentFrameIndex}
              onSelectFrameIndex={(idx) => {
                setIsPlaying(false);
                // Moving to another moment leaves the challenge of this one.
                if (inChallenge && frames[idx]?.event_uuid !== challengeState?.eventUuid) challenge.close();
                selectFrameIndex(idx);
              }}
              minute={currentFrame.minute}
              second={currentFrame.second}
              eventType={currentFrame.event_type}
              isCounterfactualMode={currentFrame.is_counterfactual_mode}
              isPlaying={isPlaying && !inChallenge}
              onTogglePlay={() => {
                if (!inChallenge) handleTogglePlay();
              }}
              onResetSimulation={() => {
                setIsPlaying(false);
                if (challengeState?.status === "open") challenge.reset();
                else if (!inChallenge) resetSimulation();
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
