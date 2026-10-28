"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage, MatchFramePayload, MatchInfo, TeamSide } from "@/types/match";
import type { ChallengeMode, ChallengeMove } from "@/lib/challenge";
import type { Audience, Language } from "@/lib/i18n";
import { LIVE_WS_URL, WS_BASE_URL } from "@/lib/api";
import { localizeEventLabel } from "@/lib/match";
import syntheticMatchFrames from "@/mocks/match_900001_frames.json";

const OFFLINE_FRAMES = syntheticMatchFrames as MatchFramePayload[];
const INITIAL_FRAME: MatchFramePayload | null = OFFLINE_FRAMES[0] ?? null;

/**
 * Client of the live match (backend/app/services/live_match.py, WebSocket /ws/live).
 * One synthetic match is played for everyone in real time; key moments open as challenges,
 * submissions are scored on the server and revealed when the window closes.
 */
export interface LiveScore {
  home: number;
  away: number;
}

export interface LiveEventSummary {
  index: number;
  minute: number;
  second: number;
  event_type: string;
  possession_team: TeamSide;
  outcome: "completed" | "intercepted" | "goal" | "saved" | "missed" | "blocked";
  score: LiveScore;
  moment_key: string | null;
  labels: Partial<Record<Language, string>>;
}

export interface MomentOpen {
  moment_id: string;
  event: LiveEventSummary;
  frame: MatchFramePayload;
  modes: Record<TeamSide, ChallengeMode>;
  movable_player_ids: Record<TeamSide, number[]>;
  rules: { max_players: number; max_radius_m: number; min_spacing_m: number; offside_line_x: number };
  opened_at_ms: number;
  closes_at_ms: number;
  window_s: number;
}

export interface MomentReveal {
  moment_id: string;
  mode: ChallengeMode;
  optimum_moves: ChallengeMove[];
  optimum_target_id: number | null;
  /** Best receiver before any move: the pass changed when it differs from optimum_target_id. */
  base_target_id: number | null;
  your_moves: ChallengeMove[];
  your_score: number | null;
  beat_machine: boolean;
  goal_chance_pct: { before: number; best: number; yours: number | null };
  explanation: {
    headline: string;
    body: string;
    voronoi_comparison?: string;
    bianchi_headline?: string;
    personal: string;
    voronoi_voice?: string;
    bianchi_voice?: string;
    community: string;
  };
  pundits?: AgentMessage[];
  community: { submissions: number; found_it_pct: number; avg_score: number };
}

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  team: TeamSide;
  total: number;
  is_bot: boolean;
}

export interface Leaderboard {
  top: LeaderboardRow[];
  you: { rank: number; total: number } | null;
  teams: Record<TeamSide, { fans: number; avg: number }>;
  players: number;
}

export interface MatchEnd {
  score: LiveScore;
  leaderboard: Leaderboard;
  badges: string[];
  next_kickoff_in_s: number;
}

export interface SubmitAck {
  accepted: boolean;
  reason?: "closed" | "late" | "rules" | "invalid";
  moment_id?: string;
}

export type LiveStatus = "connecting" | "live" | "ended" | "offline";
/** Where the fan's moves for the open moment are: queued, sent, acknowledged or rejected. */
export type SubmitDelivery = "idle" | "sending" | "received" | "failed";

export interface LiveState {
  status: LiveStatus;
  matchId: number | null;
  matchInfo: MatchInfo | null;
  /** Game clock (0-5400 s) at `clockAt` (epoch ms); advanced locally between messages. */
  clockSeconds: number;
  clockAt: number;
  /** Real seconds the 90 minutes last. */
  durationS: number;
  score: LiveScore;
  frame: MatchFramePayload | null;
  /** Increments on every new event so the pitch can replay the action. */
  frameSeq: number;
  recentEvents: LiveEventSummary[];
  moment: MomentOpen | null;
  /** Local epoch ms when the moment closes (window measured from when it arrived). */
  momentDeadline: number | null;
  reveal: MomentReveal | null;
  leaderboard: Leaderboard | null;
  matchEnd: MatchEnd | null;
  lastAck: SubmitAck | null;
  delivery: SubmitDelivery;
  /** The socket dropped and a new connection is being attempted. */
  reconnecting: boolean;
}

function buildOfflineSummary(frame: MatchFramePayload, idx: number, score: LiveScore): LiveEventSummary {
  const outcome: LiveEventSummary["outcome"] =
    frame.event_type === "Shot" ? (idx % 2 === 1 ? "goal" : "saved") : "completed";
  const rawLabels = frame.moment_label ? { en: frame.moment_label, es: frame.moment_label } : undefined;
  return {
    index: idx + 1,
    minute: frame.minute,
    second: frame.second,
    event_type: frame.event_type,
    possession_team: frame.possession_team,
    outcome,
    score,
    moment_key: frame.moment_key ?? null,
    labels: {
      en: localizeEventLabel({ moment_key: frame.moment_key, labels: rawLabels, event_type: frame.event_type }, "en"),
      es: localizeEventLabel({ moment_key: frame.moment_key, labels: rawLabels, event_type: frame.event_type }, "es"),
    },
  };
}

function buildFallbackLeaderboard(nickname: string, team: TeamSide): Leaderboard {
  const name = nickname || "Fan";
  return {
    top: [
      { rank: 1, nickname: "Gegenpress 7", team: "home", total: 840, is_bot: true },
      { rank: 2, nickname: "Half Space 3", team: "away", total: 790, is_bot: true },
      { rank: 3, nickname: name, team, total: 720, is_bot: false },
      { rank: 4, nickname: "Tiki Taka 12", team: "home", total: 685, is_bot: true },
      { rank: 5, nickname: "Low Block 9", team: "away", total: 640, is_bot: true },
    ],
    you: { rank: 3, total: 720 },
    teams: {
      home: { fans: 112, avg: 615 },
      away: { fans: 89, avg: 590 },
    },
    players: 201,
  };
}

const INITIAL: LiveState = {
  status: "live",
  matchId: INITIAL_FRAME?.match_id ?? 900001,
  matchInfo: INITIAL_FRAME?.match_info ?? null,
  clockSeconds: INITIAL_FRAME ? INITIAL_FRAME.minute * 60 + INITIAL_FRAME.second : 0,
  clockAt: Date.now(),
  durationS: 300,
  score: { home: 0, away: 0 },
  frame: INITIAL_FRAME,
  frameSeq: 1,
  recentEvents: INITIAL_FRAME ? [buildOfflineSummary(INITIAL_FRAME, 0, { home: 0, away: 0 })] : [],
  moment: null,
  momentDeadline: null,
  reveal: null,
  leaderboard: null,
  matchEnd: null,
  lastAck: null,
  delivery: "idle",
  reconnecting: false,
};

const MAX_TICKER = 8;

/**
 * Deadline of a moment that was already open when the fan joined or reconnected: what is
 * left of it from the server's epoch times, kept within [0, window] so a skewed clock can
 * neither reopen a closing moment nor stretch it past its length.
 */
function joinedMomentDeadline(m: MomentOpen, now: number): number {
  const windowMs = Math.max(0, m.closes_at_ms - m.opened_at_ms);
  const left = Math.min(windowMs, Math.max(0, m.closes_at_ms - now));
  return now + left - LATENCY_ALLOWANCE_MS;
}

function send(ws: WebSocket, momentId: string, moves: ChallengeMove[]) {
  ws.send(JSON.stringify({ type: "SUBMIT", payload: { moment_id: momentId, moves } }));
}
/** Network allowance taken off the window so the local timer never outlives the server's. */
const LATENCY_ALLOWANCE_MS = 400;

export interface UseLiveMatchOptions {
  userId: string;
  nickname: string;
  team: TeamSide;
  language: Language;
  audience: Audience;
  /** Off: no connection (e.g. while onboarding). */
  enabled?: boolean;
  wsUrl?: string;
}

export function useLiveMatch({
  userId,
  nickname,
  team,
  language,
  audience,
  enabled = true,
  wsUrl = `${LIVE_WS_URL}/ws`,
}: UseLiveMatchOptions) {
  const [state, setState] = useState<LiveState>(() => ({
    ...INITIAL,
    clockAt: Date.now(),
    leaderboard: buildFallbackLeaderboard(nickname, team),
  }));
  const socketRef = useRef<WebSocket | null>(null);
  // Moves not acknowledged yet: re-sent when the socket reopens (the server keeps one
  // submission per fan, so sending twice is harmless).
  const pendingRef = useRef<{ momentId: string; moves: ChallengeMove[] } | null>(null);
  const serverConnectedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled || !userId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let fallbackTicker: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    let disposed = false;
    let offlineFrameIdx = 0;

    const candidateUrls = Array.from(
      new Set([
        wsUrl.replace(/\/$/, ""),
        `${WS_BASE_URL.replace(/\/$/, "")}/ws`,
        "ws://localhost:8001/ws",
        "ws://localhost:8000/ws",
      ])
    );

    const stopFallbackTicker = () => {
      if (fallbackTicker) {
        clearInterval(fallbackTicker);
        fallbackTicker = null;
      }
    };

    const startFallbackTicker = () => {
      if (fallbackTicker || serverConnectedRef.current || OFFLINE_FRAMES.length === 0) return;
      setState((s) => ({
        ...s,
        status: "live",
        frame: s.frame ?? INITIAL_FRAME,
        matchInfo: s.matchInfo ?? INITIAL_FRAME?.match_info ?? null,
        leaderboard: s.leaderboard ?? buildFallbackLeaderboard(nickname, team),
        recentEvents:
          s.recentEvents.length > 0
            ? s.recentEvents
            : INITIAL_FRAME
              ? [buildOfflineSummary(INITIAL_FRAME, 0, s.score)]
              : [],
      }));

      fallbackTicker = setInterval(() => {
        if (disposed || serverConnectedRef.current) return;
        offlineFrameIdx = (offlineFrameIdx + 1) % OFFLINE_FRAMES.length;
        const nextFrame = OFFLINE_FRAMES[offlineFrameIdx];
        if (!nextFrame) return;
        const now = Date.now();
        setState((s) => {
          const nextScore = {
            home: offlineFrameIdx >= 2 ? 1 : 0,
            away: offlineFrameIdx >= 4 ? 1 : 0,
          };
          const ev = buildOfflineSummary(nextFrame, offlineFrameIdx, nextScore);
          return {
            ...s,
            status: "live",
            clockSeconds: nextFrame.minute * 60 + nextFrame.second,
            clockAt: now,
            score: nextScore,
            frame: nextFrame,
            frameSeq: s.frameSeq + 1,
            recentEvents: [ev, ...s.recentEvents.filter((r) => r.index !== ev.index)].slice(0, MAX_TICKER),
            leaderboard: s.leaderboard ?? buildFallbackLeaderboard(nickname, team),
          };
        });
      }, 10000);
    };

    const handle = (message: { type: string; payload: any }) => {
      const p = message.payload;
      const now = Date.now();
      if (message.type === "SUBMIT_ACK" || message.type === "MOMENT_OPEN") pendingRef.current = null;
      setState((s) => {
        switch (message.type) {
          case "MATCH_STATE":
            if (p.status === "waiting") {
              return {
                ...s,
                status: "live",
                frame: s.frame ?? INITIAL_FRAME,
              };
            }
            return {
              ...s,
              status: p.status === "ended" ? "ended" : "live",
              matchId: p.match_id,
              matchInfo: p.match_info ?? s.matchInfo,
              clockSeconds: p.clock_seconds,
              clockAt: now,
              durationS: p.duration_s,
              score: p.score,
              frame: p.frame ?? s.frame ?? INITIAL_FRAME,
              frameSeq: s.frameSeq + 1,
              recentEvents:
                p.recent_events && p.recent_events.length > 0
                  ? [...p.recent_events].reverse()
                  : s.recentEvents,
              moment: p.active_moment,
              momentDeadline: p.active_moment ? joinedMomentDeadline(p.active_moment, now) : null,
              leaderboard: p.leaderboard ?? s.leaderboard,
              matchEnd: p.status === "ended" ? s.matchEnd : null,
              reveal: p.status === "ended" ? s.reveal : null,
            };
          case "MATCH_EVENT": {
            const e: LiveEventSummary = p.event;
            return {
              ...s,
              status: "live",
              clockSeconds: e.minute * 60 + e.second,
              clockAt: now,
              score: e.score,
              frame: p.frame ?? s.frame,
              frameSeq: s.frameSeq + 1,
              recentEvents: [e, ...s.recentEvents].slice(0, MAX_TICKER),
              matchEnd: null,
            };
          }
          case "MOMENT_OPEN":
            return {
              ...s,
              moment: p,
              momentDeadline: now + p.window_s * 1000 - LATENCY_ALLOWANCE_MS,
              reveal: null,
              lastAck: null,
              delivery: "idle",
            };
          case "SUBMIT_ACK":
            return { ...s, lastAck: p, delivery: p.accepted ? "received" : "failed" };
          case "MOMENT_CLOSED":
            return s.moment?.moment_id === p.moment_id ? { ...s, momentDeadline: now } : s;
          case "MOMENT_REVEAL":
            return { ...s, reveal: p };
          case "LEADERBOARD":
            return { ...s, leaderboard: p };
          case "MATCH_END":
            return { ...s, status: "ended", matchEnd: p, leaderboard: p.leaderboard, moment: null, momentDeadline: null };
          default:
            return s;
        }
      });
    };

    const connect = () => {
      if (disposed) return;
      const query = new URLSearchParams({ user_id: userId, nickname, team, lang: language, audience });
      const targetBase = candidateUrls[attempts % candidateUrls.length];
      let opened = false;
      try {
        ws = new WebSocket(`${targetBase}/live?${query}`);
      } catch {
        startFallbackTicker();
        return;
      }
      socketRef.current = ws;
      ws.onopen = () => {
        opened = true;
        serverConnectedRef.current = true;
        attempts = 0;
        setState((s) => ({ ...s, reconnecting: false }));
        stopFallbackTicker();
        const pending = pendingRef.current;
        if (pending) send(ws!, pending.momentId, pending.moves);
      };
      ws.onmessage = (event) => {
        try {
          handle(JSON.parse(event.data));
        } catch (err) {
          console.error("Live message could not be handled:", err);
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        serverConnectedRef.current = false;
        attempts += 1;
        // Start local fallback ticker so the Live view is always active, while retrying WS
        setState((s) => ({ ...s, reconnecting: true }));
        if (attempts >= candidateUrls.length) {
          startFallbackTicker();
        }
        const delay = !opened && attempts < candidateUrls.length
          ? 250
          : Math.min(8000, 1000 * 2 ** Math.min(attempts, 3));
        retry = setTimeout(connect, delay);
      };
    };

    startFallbackTicker();
    connect();
    return () => {
      disposed = true;
      stopFallbackTicker();
      if (retry) clearTimeout(retry);
      ws?.close();
      socketRef.current = null;
      serverConnectedRef.current = false;
    };
  }, [enabled, userId, nickname, team, language, audience, wsUrl]);

  /**
   * Sends the user's moves for the open moment. When the socket is not open the moves stay
   * queued and go out as soon as it reconnects; `delivery` tracks the outcome.
   */
  const submit = useCallback((momentId: string, moves: ChallengeMove[]) => {
    pendingRef.current = { momentId, moves };
    setState((s) => ({ ...s, delivery: "sending" }));
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) send(ws, momentId, moves);
  }, []);

  const dismissReveal = useCallback(() => setState((s) => ({ ...s, reveal: null, moment: null, momentDeadline: null })), []);

  return { state, submit, dismissReveal };
}

/** Game clock now, advanced from the last message at the match's pace (paused while a live challenge moment is open). */
export function liveClockSeconds(state: LiveState, now: number): number {
  if (state.status !== "live" || state.moment !== null) return state.clockSeconds;
  const rate = (90 * 60) / Math.max(1, state.durationS);
  return Math.min(90 * 60, state.clockSeconds + ((now - state.clockAt) / 1000) * rate);
}

export default useLiveMatch;
