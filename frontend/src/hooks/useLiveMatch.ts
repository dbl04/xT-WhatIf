"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchFramePayload, MatchInfo, TeamSide } from "@/types/match";
import type { ChallengeMode, ChallengeMove } from "@/lib/challenge";
import type { Audience, Language } from "@/lib/i18n";
import { LIVE_WS_URL } from "@/lib/api";

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
  explanation: { headline: string; body: string; personal: string; community: string };
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

const INITIAL: LiveState = {
  status: "connecting",
  matchId: null,
  matchInfo: null,
  clockSeconds: 0,
  clockAt: 0,
  durationS: 300,
  score: { home: 0, away: 0 },
  frame: null,
  frameSeq: 0,
  recentEvents: [],
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
 * left of it, from the server's epoch times. A clock too far off to give a plausible
 * remainder falls back to the whole window.
 */
function joinedMomentDeadline(m: MomentOpen, now: number): number {
  const window = Math.max(0, m.closes_at_ms - m.opened_at_ms);
  const left = m.closes_at_ms - now;
  return now + (left >= 0 && left <= window ? left : window) - LATENCY_ALLOWANCE_MS;
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
  const [state, setState] = useState<LiveState>(INITIAL);
  const socketRef = useRef<WebSocket | null>(null);
  // Moves not acknowledged yet: re-sent when the socket reopens (the server keeps one
  // submission per fan, so sending twice is harmless).
  const pendingRef = useRef<{ momentId: string; moves: ChallengeMove[] } | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const handle = (message: { type: string; payload: any }) => {
      const p = message.payload;
      const now = Date.now();
      if (message.type === "SUBMIT_ACK" || message.type === "MOMENT_OPEN") pendingRef.current = null;
      setState((s) => {
        switch (message.type) {
          case "MATCH_STATE":
            if (p.status === "waiting") return { ...s, status: "connecting" };
            return {
              ...s,
              status: p.status === "ended" ? "ended" : "live",
              matchId: p.match_id,
              matchInfo: p.match_info,
              clockSeconds: p.clock_seconds,
              clockAt: now,
              durationS: p.duration_s,
              score: p.score,
              frame: p.frame ?? s.frame,
              frameSeq: s.frameSeq + 1,
              recentEvents: [...(p.recent_events ?? [])].reverse(),
              moment: p.active_moment,
              momentDeadline: p.active_moment ? joinedMomentDeadline(p.active_moment, now) : null,
              leaderboard: p.leaderboard,
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
              frame: p.frame,
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
      const query = new URLSearchParams({ user_id: userId, nickname, team, lang: language, audience });
      try {
        ws = new WebSocket(`${wsUrl.replace(/\/$/, "")}/live?${query}`);
      } catch {
        setState((s) => ({ ...s, status: "offline" }));
        return;
      }
      socketRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setState((s) => ({ ...s, reconnecting: false }));
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
        attempts += 1;
        // After two failed attempts the app falls back to the offline key moments.
        setState((s) => ({ ...s, reconnecting: true, ...(attempts >= 2 ? { status: "offline" } : {}) }));
        retry = setTimeout(connect, Math.min(10000, 1000 * 2 ** Math.min(attempts, 4)));
      };
    };

    setState(INITIAL);
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
      socketRef.current = null;
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

/** Game clock now, advanced from the last message at the match's pace. */
export function liveClockSeconds(state: LiveState, now: number): number {
  if (state.status !== "live") return state.clockSeconds;
  const rate = (90 * 60) / Math.max(1, state.durationS);
  return Math.min(90 * 60, state.clockSeconds + ((now - state.clockAt) / 1000) * rate);
}

export default useLiveMatch;
