"use strict";
"use client";

import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { TacticalPitch2D, TacticalPitch2DHandle } from "@/components/pitch/TacticalPitch2D";
import { XtDeltaPanel } from "@/components/metrics/XtDeltaPanel";
import { PlaybackBar } from "@/components/controls/PlaybackBar";
import { ExportReportModal } from "@/components/controls/ExportReportModal";
import { FullTimeReportModal } from "@/components/controls/FullTimeReportModal";
import { useFullTimeReport } from "@/hooks/useFullTimeReport";
import { CloudTelemetryModal } from "@/components/controls/CloudTelemetryModal";
import { InfoModal, useFirstVisitInfo } from "@/components/controls/InfoModal";
import { AutoCoachPanel } from "@/components/controls/AutoCoachPanel";
import { VoiceWhatIfPanel } from "@/components/controls/VoiceWhatIfPanel";
import { ScenarioComparatorModal } from "@/components/metrics/ScenarioComparatorModal";
import { ProfileSwitcher } from "@/components/controls/ProfileSwitcher";
import { OnboardingGate, useFanSession } from "@/components/onboarding/OnboardingGate";
import { FanBadge } from "@/components/onboarding/FanBadge";
import { ChallengeCard, ChallengeStrip, PlayMomentCard, type LiveDelivery } from "@/components/challenge/ChallengeCards";
import { Button, IconButton } from "@/components/ui/primitives";
import { useMatchEngine } from "@/hooks/useMatchEngine";
import { useChallenge } from "@/hooks/useChallenge";
import { LIVE_API_URL } from "@/lib/api";
import { liveClockSeconds, useLiveMatch, type MomentReveal } from "@/hooks/useLiveMatch";
import { useRevealReplay } from "@/hooks/useRevealReplay";
import { LeaderboardCard, LiveStatusCard, MatchEndCard, RevealCard } from "@/components/live/LiveCards";
import { evaluateChallenge, modeFor, type ChallengeMove } from "@/lib/challenge";
import type { PitchChallenge } from "@/components/pitch/TacticalPitch2D";
import { useBroadcastTTS } from "@/hooks/useBroadcastTTS";
import { sfx } from "@/lib/sfx";
import { getMatchInfo } from "@/lib/match";
import { useI18n } from "@/lib/i18n";
import { MAX_VOICE_MOVES } from "@/lib/voiceWhatIf";
import { AgentMessage, MatchFramePayload, PlayerNode } from "@/types/match";
import {
  Download,
  HelpCircle,
  Columns2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/** Pre-match onboarding (profile → team) and then the live dashboard. */
export default function HomePage() {
  const [firstVisitInfo, closeFirstVisitInfo] = useFirstVisitInfo();
  return (
    <>
      <OnboardingGate>
        <DashboardPage />
      </OnboardingGate>
      <InfoModal isOpen={firstVisitInfo} onClose={closeFirstVisitInfo} />
    </>
  );
}

/** Reveal: the pass the optimum opens, from the ball to its receiver where the optimum leaves them. */
/** Pundit lines of a live reveal with their pre-synthesised audio (null audio: browser voice). */
async function fetchRevealVoice(
  momentId: string,
  userId: string
): Promise<{ agent_role: string; audio_base64: string | null }[] | null> {
  try {
    const res = await fetch(
      `${LIVE_API_URL}/api/v1/live/moments/${encodeURIComponent(momentId)}/voice?user_id=${encodeURIComponent(userId)}`,
      { signal: AbortSignal.timeout(9000) }
    );
    return res.ok ? (await res.json()).lines : null;
  } catch {
    return null;
  }
}

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
  const onSimDoneRef = useRef<(frame: MatchFramePayload) => void>(() => {});
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
    applySimulatedFrame,
    onPlayerDrop,
    triggerSimulation,
    resetSimulation,
  } = useMatchEngine({
    language,
    audience,
    onSimulationComplete: (simFrame) => onSimDoneRef.current(simFrame),
  });

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
  const [isFullTimeReportOpen, setIsFullTimeReportOpen] = useState<boolean>(false);
  const [isCloudTelemetryOpen, setIsCloudTelemetryOpen] = useState<boolean>(false);
  const [isDemoGuideOpen, setIsDemoGuideOpen] = useState<boolean>(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState<boolean>(false);
  const [isHudDrawerOpen, setIsHudDrawerOpen] = useState<boolean>(true);
  const [freeMoveLimitNotice, setFreeMoveLimitNotice] = useState<boolean>(false);

  const pitchRef = useRef<TacticalPitch2DHandle | null>(null);


  // Moves players and simulates in one go. triggerSimulation receives the moved players
  // explicitly because its `frames` snapshot does not include updates from this same tick.
  // Resets previous modifications on the frame first so Auto-Coach or Scenario Restore
  // never accumulates or drops players when a manual move was already on the board.
  const applyMovesAndSimulate = (players: PlayerNode[]) => {
    resetSimulation();
    const moved = players.filter((p) => p.is_modified).slice(0, MAX_VOICE_MOVES);
    moved.forEach((p) => updatePlayerPosition(p.player_id, p.x, p.y));
    triggerSimulation(moved);
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
  // The Live view is the main/default page unless the user explicitly switches to Practice mode.
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
  const fullTimeReport = useFullTimeReport(liveState);
  const [practising, setPractising] = useState(false);
  const isLiveView = !practising;

  // From lg the pitch takes the widest 3:2 box that fits next to the dock and above the
  // lower-third and the transport; the dock and the pitch column are then centred together so
  // spare width is shared on both sides. Below lg the wrappers have no box and the CSS cap applies.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const pitchColumnRef = useRef<HTMLDivElement | null>(null);
  const belowPitchRef = useRef<HTMLDivElement | null>(null);
  const [pitchMaxWidth, setPitchMaxWidth] = useState<number | null>(null);
  // The side columns start where the pitch frame starts (it is centred in its column), and the
  // right column also ends where it ends.
  const pitchBoxRef = useRef<HTMLDivElement | null>(null);
  const [pitchBox, setPitchBox] = useState<{ top: number; height: number; stageH: number } | null>(null);
  useEffect(() => {
    const box = pitchBoxRef.current;
    const stage = stageRef.current;
    if (!box || !stage || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches || !box.offsetHeight) {
        setPitchBox(null);
        return;
      }
      const style = getComputedStyle(stage);
      const stageTop = stage.getBoundingClientRect().top + parseFloat(style.paddingTop);
      const stageH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const top = Math.max(0, Math.round(box.getBoundingClientRect().top - stageTop));
      setPitchBox((prev) =>
        prev && prev.top === top && prev.height === box.offsetHeight && prev.stageH === stageH
          ? prev
          : { top, height: box.offsetHeight, stageH }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(stage);
    if (belowPitchRef.current) observer.observe(belowPitchRef.current);
    return () => observer.disconnect();
  }, []);

  const [practiceReveal, setPracticeReveal] = useState<MomentReveal | null>(null);
  const practiceSubmissionRef = useRef<{ frame: MatchFramePayload; moves: ChallengeMove[] } | null>(null);

  const challenge = useChallenge({
    onSubmit: (submission) => {
      if (submission.auto) sfx.whistle();
      else sfx.confirm();
      // Only legal moves are sent: a player breaking a rule stays in place (the server would
      // reject the whole submission otherwise).
      const broken = new Set((challenge.state?.violations ?? []).map((v) => v.player_id));
      const legalMoves = submission.moves.filter((m) => !broken.has(m.player_id));
      const moment = liveState.moment;
      if (isLiveView && moment && moment.frame.event_uuid === submission.eventUuid) {
        live.submit(moment.moment_id, legalMoves);
        return;
      }
      // Practice / Key Moments mode: evaluate immediately and reveal the optimal move + pundit analysis.
      const baseFrame = challenge.state?.baseFrame ?? currentFrame;
      practiceSubmissionRef.current = { frame: baseFrame, moves: legalMoves };
      void evaluateChallenge(
        {
          match_id: submission.matchId,
          event_uuid: submission.eventUuid,
          team: submission.team,
          moves: legalMoves,
          language,
          audience,
        },
        baseFrame
      ).then((res) => {
        setPracticeReveal(res);
      });
    },
  });
  const challengeState = challenge.state;
  const inChallenge = challengeState !== null;

  // Refresh practice reveal narration whenever language or audience profile changes.
  useEffect(() => {
    const sub = practiceSubmissionRef.current;
    if (!sub || !practiceReveal) return;
    let cancelled = false;
    void evaluateChallenge(
      {
        match_id: sub.frame.match_id,
        event_uuid: sub.frame.event_uuid,
        team: supportedSide,
        moves: sub.moves,
        language,
        audience,
      },
      sub.frame
    ).then((res) => {
      if (!cancelled) setPracticeReveal(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, audience]);

  // Primary voice for the selected audience mode: Analyst/Audio -> Dr. Voronoi; Coach/Casual -> Coach Bianchi.
  const preferredVoiceRole: AgentMessage["agent_role"] =
    audience === "coach" || audience === "casual" ? "classic_coach" : "data_scientist";

  // In Key Moments mode (!isLiveView), whenever a move simulation completes, have ONLY the selected mode's commentator speak.
  onSimDoneRef.current = (simFrame: MatchFramePayload) => {
    if (!isLiveView && !inChallenge && simFrame.agent_debate?.length > 0) {
      const targetMsg =
        simFrame.agent_debate.find((m) => m.agent_role === preferredVoiceRole) ?? simFrame.agent_debate[0];
      if (targetMsg) tts.playMessages([targetMsg]);
    }
  };

  // Live view: the leaderboard gets its own column on the right when that costs the pitch nothing
  // (wide, short windows where the pitch is limited by height).
  const [boardOnRight, setBoardOnRight] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    const dock = dockRef.current;
    const below = belowPitchRef.current;
    if (!stage || !dock || !below || typeof ResizeObserver === "undefined") return;
    // Pitch top bar (44 px + border), footer (33 px), frame border.
    const PITCH_CHROME_PX = 82;
    const measure = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        // Stacked layout: the leaderboard always sits next to the match events again.
        setBoardOnRight(false);
        setPitchMaxWidth(null);
        return;
      }
      const style = getComputedStyle(stage);
      const innerW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const innerH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const width = innerW - dock.offsetWidth - 16;
      const belowH = below.offsetHeight;
      const height = innerH - (belowH > 0 ? belowH + 12 : 60) - PITCH_CHROME_PX;
      // The right column is as wide as the dock.
      const widthWithBoard = width - dock.offsetWidth - 16;
      const boardFits = isLiveView && widthWithBoard >= height * 1.5;
      setBoardOnRight(boardFits);
      setPitchMaxWidth(Math.floor(Math.max(320, Math.min(boardFits ? widthWithBoard : width, height * 1.5))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(dock);
    observer.observe(below);
    return () => observer.disconnect();
  }, [isLiveView, inChallenge]);

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

  const leaveChallenge = useCallback(() => {
    setPracticeReveal(null);
    practiceSubmissionRef.current = null;
    closeChallenge();
  }, [closeChallenge]);

  const continueAfterReveal = () => {
    tts.stop();
    setPracticeReveal(null);
    practiceSubmissionRef.current = null;
    live.dismissReveal();
    closeChallenge();
  };

  const goToLive = () => {
    setPractising(false);
    setFreeMoveLimitNotice(false);
    setPracticeReveal(null);
    practiceSubmissionRef.current = null;
    live.dismissReveal();
    closeChallenge();
    setIsPlaying(false);
    tts.stop();
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
    resetSimulation();
  };

  const goToPractice = () => {
    setPractising(true);
    setFreeMoveLimitNotice(false);
    setPracticeReveal(null);
    practiceSubmissionRef.current = null;
    live.dismissReveal();
    closeChallenge();
    setIsPlaying(false);
    tts.stop();
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
  };

  // Keyboard shortcuts in Key Moments mode (!isLiveView): Space to Play/Pause, R to Reset
  useEffect(() => {
    if (isLiveView) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" && !inChallenge) {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if ((e.key === "r" || e.key === "R") && !inChallenge) {
        e.preventDefault();
        setIsPlaying(false);
        setFreeMoveLimitNotice(false);
        tts.stop();
        resetSimulation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLiveView, inChallenge, tts, resetSimulation]);

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
    setPracticeReveal(null);
    practiceSubmissionRef.current = null;
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
    setIsHudDrawerOpen(true);
    sfx.whistle();
    challenge.open({ frame: currentFrame, team: supportedSide });
  };

  const { flashNotice } = challenge;
  const reveal = isLiveView
    ? liveState.reveal && liveState.reveal.moment_id === liveState.moment?.moment_id
      ? liveState.reveal
      : null
    : practiceReveal;

  // Single reveal speaker (Coach Bianchi) speaks at the end of a live challenge moment.
  const playRevealVoice = useCallback(
    (rev: MomentReveal) => {
      const { headline, body, personal, bianchi_headline, bianchi_voice } = rev.explanation;
      const optIds = rev.optimum_moves.map((m) => m.player_id);
      const userIds = rev.your_moves.map((m) => m.player_id);
      const bianchiSpoken = (bianchi_voice || `${body} ${personal}`).trim();
      const speakerLine: AgentMessage = {
        message_id: `${rev.moment_id}-classic_coach`,
        agent_role: "classic_coach",
        agent_name: "Coach Bianchi",
        avatar_badge: "PRO-COACH",
        timestamp_label: "",
        headline: bianchi_headline || headline,
        analysis_body: bianchiSpoken,
        referenced_metric: "",
        highlighted_player_ids: userIds.length > 0 ? userIds : optIds,
      };
      const lines = bianchiSpoken ? [speakerLine] : [];
      // Audio the live service synthesised while the moment was open: ready as the reveal lands.
      const voice = fetchRevealVoice(rev.moment_id, fanSession?.identity.userId ?? "");
      tts.playMessages(
        lines,
        lines.map((m) => voice.then((v) => v?.find((l) => l.agent_role === m.agent_role)?.audio_base64 ?? null))
      );
    },
    [fanSession?.identity.userId, tts]
  );

  // One sound per reveal: rising when the fan found (nearly) the best move.
  const revealSoundRef = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal || revealSoundRef.current === reveal.moment_id) return;
    revealSoundRef.current = reveal.moment_id;
    sfx.reveal(reveal.beat_machine || (reveal.your_score ?? 0) >= 900);
    playRevealVoice(reveal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const leaderboardCard = (
    <LeaderboardCard
      leaderboard={liveState.leaderboard}
      matchInfo={liveMatchInfo}
      nickname={fanSession?.identity.nickname ?? ""}
      team={supportedSide}
      fill="stacked"
    />
  );

  return (
    <main className="relative flex min-h-screen w-full select-none flex-col bg-ink text-fg lg:h-screen lg:overflow-hidden">
      {/* Below lg the floating broadcast panels would cover most of the pitch, so the stage turns
          into a scrolling column: pitch, transport, dock, pundits. lg and up keep the overlay. */}

      {/* 1. Top Broadcast Bar */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          {/* Wordmark — clicking returns to the Live match view */}
          <button
            type="button"
            onClick={goToLive}
            title={t("live.backToLive")}
            className="flex cursor-pointer items-baseline gap-0.5 font-display text-[22px] font-extrabold uppercase leading-none tracking-tight transition-opacity hover:opacity-80 focus:outline-none"
          >
            <span className="text-fg">xT</span>
            <span className="text-signal-gain">/</span>
            <span className="text-fg">WhatIf</span>
          </button>

          <span className="hidden h-6 w-px bg-line-strong sm:block" />

          {/* Scorebug */}
          <div className="hidden h-9 shrink-0 items-stretch overflow-hidden rounded-[3px] border border-line-strong font-display text-xl font-bold uppercase leading-none tracking-wide sm:flex">
            <span className="flex items-center gap-2 bg-fg px-3 text-ink">
              <span className="h-4 w-1.5 bg-team-home" />
              {fixture.home.short_name}
            </span>
            {isLiveView && (
              <span className="flex items-center bg-ink-700 px-3 tabular-nums text-fg">
                {liveState.score.home}–{liveState.score.away}
              </span>
            )}
            <span className="flex min-w-[76px] items-center justify-center bg-ink-800 px-3 tabular-nums text-fg">
              {clock}
            </span>
            <span className="flex items-center gap-2 bg-fg px-3 text-ink">
              {fixture.away.short_name}
              <span className="h-4 w-1.5 bg-ink" />
            </span>
          </div>

          <div className="hidden min-w-0 flex-col 2xl:flex">
            <span className="truncate text-xs text-fg-muted">
              {fixture.home.name} v {fixture.away.name}
              {currentFrame.is_counterfactual_mode && (
                <>
                  {" "}·{" "}
                  <span className="text-signal-gain">{t("header.simulated")}</span>
                </>
              )}
            </span>
          </div>

          {/* 1-Click Mode Switcher: Live Match vs Key Moments & Voice */}
          <div
            role="group"
            aria-label={t("nav.modeAria")}
            className="hidden items-center rounded-md border border-line-strong bg-ink-800 p-0.5 md:inline-flex"
          >
            <button
              type="button"
              onClick={goToLive}
              aria-pressed={isLiveView}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-semibold transition-colors ${
                isLiveView
                  ? "bg-white/[0.12] text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isLiveView ? "bg-signal-gain" : "bg-fg-subtle"}`} />
              {t("nav.mode.live")}
            </button>
            <button
              type="button"
              onClick={goToPractice}
              aria-pressed={!isLiveView}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-semibold transition-colors ${
                !isLiveView
                  ? "bg-white/[0.12] text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t("nav.mode.practice")}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-0.5">
          {!isLiveView && (
            <>
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
            </>
          )}

          {/* Infrastructure is hidden so the fixture line fits */}

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

          {/* Live: the fan's report only exists from full time on. Practice: the board's report. */}
          <Button
            variant="primary"
            onClick={() => (isLiveView ? setIsFullTimeReportOpen(true) : setIsExportModalOpen(true))}
            disabled={isLiveView && !fullTimeReport}
            title={isLiveView ? t("nav.exportLiveTitle") : t("nav.exportTitle")}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("nav.export")}</span>
          </Button>
        </nav>
      </header>

      {/* 2. Main Stadium Viewport */}
      {/* lg and up: the side dock is its own column and the pitch column stacks the pitch, the
          lower-third and the transport, so nothing covers the board. Below lg the stage is one
          scrolling column (the wrappers are display: contents and the order-* classes apply). */}
      <div
        ref={stageRef}
        className="relative z-10 flex w-full flex-1 flex-col gap-3 p-2 sm:p-4 lg:h-full lg:min-h-0 lg:flex-row lg:items-stretch lg:justify-center lg:gap-4 lg:overflow-hidden"
      >
        <div
          ref={pitchColumnRef}
          className="contents lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-none lg:flex-col lg:items-center lg:justify-center lg:gap-3"
          style={pitchMaxWidth ? { width: pitchMaxWidth } : undefined}
        >
        {/* Below lg the width is capped so the 3:2 pitch fits the viewport height (10.5rem =
            header + stage padding + the pitch's own bars). From lg the column is measured. */}
        <div
          ref={pitchBoxRef}
          className="order-1 flex w-full items-center justify-center self-center lg:order-none"
          style={{ maxWidth: pitchMaxWidth ?? "min(1720px, calc((100vh - 10.5rem) * 1.5))" }}
        >
          <TacticalPitch2D
            ref={pitchRef}
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
            readOnly={!inChallenge}
            maxFreeMoves={MAX_VOICE_MOVES}
            onFreeMoveLimitReached={() => {
              sfx.blocked();
              setFreeMoveLimitNotice(true);
            }}
            playbackSpeed={playbackSpeed}
            highlightedPlayerIds={highlightedPlayerIds}
            selectedPlayerId={hoveredPlayerId}
            onHoverPlayer={setHoveredPlayerId}
            onClickPlayer={(id) =>
              setHoveredPlayerId(id === hoveredPlayerId ? null : id)
            }
            // In a challenge the board belongs to useChallenge: no counterfactual simulation
            // or debate on drop (that is the reveal's job), only the preview arrow.
            onPlayerMove={inChallenge ? challenge.move : () => {}}
            onSimulationTrigger={inChallenge ? dropInChallenge : () => {}}
            onAnimationEnd={handleAnimationEnd}
            onDragStart={handleDragStart}
          />
        </div>

        {/* Live view: nothing sits under the pitch on lg (no transport, no lower-third). */}
        <div
          ref={belowPitchRef}
          className={`contents lg:flex lg:w-full lg:shrink-0 lg:flex-col lg:items-center lg:gap-3 ${isLiveView ? "lg:hidden" : ""}`}
        >
        {/* 5. Transport Dock */}
        <div className={`pointer-events-none order-2 flex w-full flex-col items-center gap-3 lg:order-2 ${isLiveView ? "lg:hidden" : ""}`}>
          {challengeState && !reveal && (
            <div className="pointer-events-auto w-full max-w-xl lg:hidden">
              <ChallengeStrip
                state={challengeState}
                secondsLeft={challenge.secondsLeft}
                notice={challenge.notice}
                teamInfo={fanSession?.teamInfo}
                onConfirm={() => challenge.submit(false)}
                onReset={challenge.reset}
                onLeave={leaveChallenge}
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
                setFreeMoveLimitNotice(false);
                tts.stop();
                // Moving to another moment leaves the challenge of this one.
                if (inChallenge && frames[idx]?.event_uuid !== challengeState?.eventUuid) leaveChallenge();
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
                setFreeMoveLimitNotice(false);
                tts.stop();
                if (challengeState?.status === "open") challenge.reset();
                else if (!inChallenge) resetSimulation();
              }}
              onSpeedChange={(s) => setPlaybackSpeed(s)}
            />
          </div>
        </div>
        </div>
        </div>

        {/* 3. Tactical Dock (left column from lg) */}
        <div
          ref={dockRef}
          className="pointer-events-none order-3 flex w-full flex-col lg:order-first lg:h-full lg:min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto 2xl:w-[360px]"
          // Starts level with the pitch frame and uses the height left below that.
          style={pitchBox ? { marginTop: pitchBox.top, height: pitchBox.stageH - pitchBox.top } : undefined}
        >
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
                    activeSpeaker={tts.activeSpeaker}
                    isSpeaking={tts.isPlaying}
                    onPlayVoice={() => playRevealVoice(reveal)}
                    onStopVoice={tts.stop}
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
                  onLeave={leaveChallenge}
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
              className="pointer-events-auto grid rounded-lg border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:grid-cols-2 lg:flex lg:max-h-[calc(100vh-7rem)] lg:flex-col lg:overflow-y-auto"
            >
              {/* Below lg: match events and leaderboard side by side (from sm). From lg: one column,
                  unless the leaderboard has moved to its own column on the right. */}
              <section className="border-b border-line p-3 sm:border-b-0 sm:border-r lg:border-r-0 lg:border-b">
                {liveState.matchEnd ? (
                  <MatchEndCard
                    end={liveState.matchEnd}
                    matchInfo={liveMatchInfo}
                    onExport={fullTimeReport ? () => setIsFullTimeReportOpen(true) : undefined}
                  />
                ) : (
                  <LiveStatusCard
                    live={liveState}
                    clockSeconds={liveClock}
                    matchInfo={liveMatchInfo}
                    onPractice={goToPractice}
                  />
                )}
              </section>
              {!boardOnRight && <section className="flex flex-col p-3">{leaderboardCard}</section>}
            </motion.aside>
          ) : (
          <AnimatePresence>
            {isHudDrawerOpen && (
              <motion.aside
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="pointer-events-auto flex flex-col rounded-lg lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
              >
                {practising && (
                  <section className="border-b border-line p-3">
                    <Button variant="secondary" className="w-full" onClick={goToLive}>
                      {t("live.backToLive")}
                    </Button>
                  </section>
                )}

                {/* Microphone Voice Input Mode — ONLY in Key Moments mode (!isLiveView) */}
                <section className="border-b border-line p-3">
                  <VoiceWhatIfPanel
                    currentFrame={currentFrame}
                    onBeforeListen={() => {
                      setIsPlaying(false);
                      tts.stop();
                    }}
                    onMovePlayer={updatePlayerPosition}
                    onApplySimulatedFrame={applySimulatedFrame}
                    onTriggerOfflineSimulation={applyMovesAndSimulate}
                    onHighlightPlayers={setHighlightedPlayerIds}
                    onResetMoves={() => {
                      setIsPlaying(false);
                      setFreeMoveLimitNotice(false);
                      tts.stop();
                      resetSimulation();
                    }}
                    externalLimitNotice={freeMoveLimitNotice}
                  />
                </section>

                {/* xT Live Challenge entry */}
                <section className="border-b border-line p-3">
                  <PlayMomentCard
                    mode={modeFor(supportedSide, currentFrame)}
                    possessionTeam={fixture[currentFrame.possession_team]}
                    supportedTeam={fixture[supportedSide]}
                    onPlay={startChallenge}
                  />
                </section>

                {/* Auto-Coach */}
                <section className="border-b border-line p-3">
                  <AutoCoachPanel
                    currentFrame={currentFrame}
                    onApplyOptimalDefense={applyMovesAndSimulate}
                    onResetDefense={() => {
                      setFreeMoveLimitNotice(false);
                      tts.stop();
                      resetSimulation();
                    }}
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
                      setFreeMoveLimitNotice(false);
                      tts.stop();
                      resetSimulation();
                    }}
                  />
                </section>
              </motion.aside>
            )}
          </AnimatePresence>
          )}
        </div>


        {/* Right column (live, wide and short windows): the leaderboard */}
        {isLiveView && boardOnRight && (
          <div
            className="pointer-events-none hidden lg:flex lg:min-h-0 lg:w-[320px] lg:shrink-0 lg:flex-col lg:self-start 2xl:w-[360px]"
            // Same top and bottom as the pitch frame.
            style={pitchBox ? { marginTop: pitchBox.top, height: pitchBox.height } : undefined}
          >
            <aside
              aria-label={t("board.kicker")}
              className="pointer-events-auto flex h-full min-h-0 flex-col rounded-lg border border-line-strong bg-ink-900/95 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
            >
              <LeaderboardCard
                leaderboard={liveState.leaderboard}
                matchInfo={liveMatchInfo}
                nickname={fanSession?.identity.nickname ?? ""}
                team={supportedSide}
                fill="always"
              />
            </aside>
          </div>
        )}
      </div>

      {/* Modals */}
      <FullTimeReportModal
        isOpen={isFullTimeReportOpen}
        onClose={() => setIsFullTimeReportOpen(false)}
        snapshot={fullTimeReport}
        nickname={fanSession?.identity.nickname ?? ""}
      />
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

      <InfoModal
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
