"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchFramePayload, PlayerNode, TeamSide } from "@/types/match";
import {
  CHALLENGE_DURATION_S,
  ChallengeMode,
  ChallengeMove,
  ChallengeRules,
  ChallengeTrend,
  ChallengeViolation,
  clampToRadius,
  fetchPreview,
  modeFor,
  movablePlayerIds,
  offlineRules,
  validateMovesOffline,
} from "@/lib/challenge";

/** Minimum gap between preview calls while dragging (the endpoint allows 240 calls/min). */
const DRAG_PREVIEW_INTERVAL_MS = 300;

export type ChallengeStatus = "open" | "submitted";

export interface ChallengeState {
  status: ChallengeStatus;
  matchId: number;
  eventUuid: string;
  team: TeamSide;
  mode: ChallengeMode;
  /** Snapshot of the moment as it was opened (original positions). */
  baseFrame: MatchFramePayload;
  /** Board shown on the pitch: base players plus the user's moves (is_modified + original_x/y). */
  players: PlayerNode[];
  movableIds: number[];
  rules: ChallengeRules;
  violations: ChallengeViolation[];
  trend: ChallengeTrend;
  /** True while a preview request is in flight. */
  checking: boolean;
  /** Backend unreachable: rules checked client-side and the trend stays "same". */
  offline: boolean;
  /** Epoch ms when the window closes (auto-submit). */
  deadline: number;
  durationS: number;
  /** Set once submitted. */
  submission: ChallengeSubmission | null;
  /** Backend that knows this moment (the live-match service for live moments). */
  previewBaseUrl?: string;
}

export interface ChallengeSubmission {
  matchId: number;
  eventUuid: string;
  team: TeamSide;
  moves: ChallengeMove[];
  /** True when the clock ran out. */
  auto: boolean;
  submittedAt: number;
}

/**
 * What a future `MOMENT_OPEN` message needs to provide: the frame of the moment, the team
 * the user supports and, optionally, the server deadline so every client shares the clock.
 */
export interface OpenChallengeInput {
  frame: MatchFramePayload;
  team: TeamSide;
  durationS?: number;
  /** Epoch ms; defaults to now + durationS. */
  deadline?: number;
  /** Backend for the preview calls; defaults to the gateway (API_BASE_URL). */
  previewBaseUrl?: string;
  /** Initial player moves to apply as soon as the challenge opens (e.g. from voice). */
  initialMoves?: Array<{ playerId: number; x: number; y: number }>;
}

export interface UseChallengeOptions {
  /** Called once on submit (Confirm or the clock). A later task sends `SUBMIT` over WebSocket here. */
  onSubmit?: (submission: ChallengeSubmission) => void;
}

/** Players reset to their original positions, with no move flags. */
function basePlayers(frame: MatchFramePayload): PlayerNode[] {
  return frame.players.map((p) => ({
    ...p,
    x: p.original_x ?? p.x,
    y: p.original_y ?? p.y,
    original_x: null,
    original_y: null,
    is_modified: false,
  }));
}

export function movesOf(players: PlayerNode[]): ChallengeMove[] {
  return players.filter((p) => p.is_modified).map((p) => ({ player_id: p.player_id, x: p.x, y: p.y }));
}

/**
 * Challenge mode of a key moment: 30 s to move up to 2 players of the user's team.
 * The board lives here (not in useMatchEngine) so moves never trigger the counterfactual
 * simulation or the pundits' debate; those belong to the reveal.
 */
export function useChallenge({ onSubmit }: UseChallengeOptions = {}) {
  const [state, setState] = useState<ChallengeState | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [notice, setNotice] = useState<"limit" | "locked" | null>(null);

  const stateRef = useRef<ChallengeState | null>(null);
  stateRef.current = state;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastPreviewAt = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPreview = useCallback(() => {
    requestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (trailingTimer.current) clearTimeout(trailingTimer.current);
    trailingTimer.current = null;
  }, []);

  /** Ask the backend about the current board; client-side rules are applied straight away. */
  const runPreview = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.status !== "open") return;
    const moves = movesOf(s.players);
    const seq = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastPreviewAt.current = Date.now();

    // Instant local feedback while the server answers.
    setState((prev) =>
      prev && prev.eventUuid === s.eventUuid
        ? {
            ...prev,
            checking: true,
            violations: validateMovesOffline(prev.baseFrame, prev.mode, prev.rules, prev.movableIds, moves),
          }
        : prev
    );

    fetchPreview(
      { match_id: s.matchId, event_uuid: s.eventUuid, team: s.team, moves },
      controller.signal,
      s.previewBaseUrl
    )
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setState((prev) =>
          prev && prev.eventUuid === s.eventUuid && prev.status === "open"
            ? {
                ...prev,
                mode: res.mode,
                movableIds: res.movable_player_ids,
                rules: res.rules,
                violations: res.violations,
                trend: res.trend,
                checking: false,
                offline: false,
              }
            : prev
        );
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current || (err instanceof DOMException && err.name === "AbortError")) return;
        setState((prev) =>
          prev && prev.eventUuid === s.eventUuid
            ? { ...prev, trend: "same", checking: false, offline: true }
            : prev
        );
      });
  }, []);

  /** Throttled preview for live feedback while dragging (trailing call guaranteed). */
  const schedulePreview = useCallback(() => {
    const wait = Math.max(16, DRAG_PREVIEW_INTERVAL_MS - (Date.now() - lastPreviewAt.current));
    if (trailingTimer.current) clearTimeout(trailingTimer.current);
    trailingTimer.current = setTimeout(() => {
      trailingTimer.current = null;
      runPreview();
    }, wait);
  }, [runPreview]);

  const flashNotice = useCallback((kind: "limit" | "locked") => {
    setNotice(kind);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  }, []);

  /** Opens the challenge on a moment. Entry point for a future `MOMENT_OPEN` message. */
  const open = useCallback(
    ({ frame, team, durationS = CHALLENGE_DURATION_S, deadline, previewBaseUrl, initialMoves }: OpenChallengeInput) => {
      cancelPreview();
      const mode = modeFor(team, frame);
      let players = basePlayers(frame);
      if (initialMoves && initialMoves.length > 0) {
        const movesMap = new Map(initialMoves.map((m) => [m.playerId, m]));
        players = players.map((p) => {
          const m = movesMap.get(p.player_id);
          if (!m) return p;
          const ox = p.original_x ?? p.x;
          const oy = p.original_y ?? p.y;
          return {
            ...p,
            x: m.x,
            y: m.y,
            original_x: ox,
            original_y: oy,
            is_modified: true,
          };
        });
      }
      const baseFrame: MatchFramePayload = { ...frame, players: basePlayers(frame), is_counterfactual_mode: false };
      const next: ChallengeState = {
        status: "open",
        matchId: frame.match_id,
        eventUuid: frame.event_uuid,
        team,
        mode,
        baseFrame,
        players,
        movableIds: movablePlayerIds(baseFrame, mode),
        rules: offlineRules(baseFrame, mode),
        violations: [],
        trend: "same",
        checking: false,
        offline: false,
        deadline: deadline ?? Date.now() + durationS * 1000,
        durationS,
        submission: null,
        previewBaseUrl,
      };
      stateRef.current = next;
      setState(next);
      setNow(Date.now());
      setNotice(null);
      // Movable players and rules from the server (empty moves).
      runPreview();
    },
    [cancelPreview, runPreview]
  );

  /** Whether the challenge is currently open and interactive. */
  const isChallengeOpen = useCallback(() => stateRef.current?.status === "open", []);

  /** Applies multiple player moves directly into the open challenge state. */
  const applyMoves = useCallback(
    (moves: Array<{ playerId: number; x: number; y: number }>) => {
      const s = stateRef.current;
      if (!s || s.status !== "open") return;
      const movesMap = new Map(moves.map((m) => [m.playerId, m]));
      let hasChanges = false;
      const players = s.players.map((p) => {
        const m = movesMap.get(p.player_id);
        if (!m) return p;
        const ox = p.original_x ?? p.x;
        const oy = p.original_y ?? p.y;
        const pos = clampToRadius(ox, oy, m.x, m.y, s.rules.max_radius_m);
        if (pos.x !== p.x || pos.y !== p.y) hasChanges = true;
        return {
          ...p,
          x: pos.x,
          y: pos.y,
          original_x: ox,
          original_y: oy,
          is_modified: pos.x !== ox || pos.y !== oy,
        };
      });
      if (!hasChanges) return;
      const next = { ...s, players };
      stateRef.current = next;
      setState(next);
      schedulePreview();
    },
    [schedulePreview]
  );

  /** Whether a player may be dragged right now. */
  const canMove = useCallback((playerId: number): "ok" | "locked" | "limit" => {
    const s = stateRef.current;
    if (!s || s.status !== "open" || !s.movableIds.includes(playerId)) return "locked";
    const moved = s.players.filter((p) => p.is_modified && p.player_id !== playerId).length;
    return moved >= s.rules.max_players ? "limit" : "ok";
  }, []);

  /** Drag update: clamps to the radius around the original position (hard limit). */
  const move = useCallback(
    (playerId: number, x: number, y: number) => {
      const s = stateRef.current;
      if (!s || canMove(playerId) !== "ok") return;
      const player = s.players.find((p) => p.player_id === playerId);
      if (!player) return;
      const ox = player.original_x ?? player.x;
      const oy = player.original_y ?? player.y;
      const pos = clampToRadius(ox, oy, x, y, s.rules.max_radius_m);
      if (player.x === pos.x && player.y === pos.y) return;
      const players = s.players.map((p) =>
        p.player_id === playerId
          ? { ...p, x: pos.x, y: pos.y, original_x: ox, original_y: oy, is_modified: pos.x !== ox || pos.y !== oy }
          : p
      );
      const next = { ...s, players };
      stateRef.current = next;
      setState(next);
      schedulePreview();
    },
    [canMove, schedulePreview]
  );

  /** Drop: preview immediately. */
  const drop = useCallback(() => {
    if (stateRef.current?.status !== "open") return;
    if (trailingTimer.current) clearTimeout(trailingTimer.current);
    trailingTimer.current = null;
    runPreview();
  }, [runPreview]);

  const reset = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.status !== "open") return;
    cancelPreview();
    const next: ChallengeState = {
      ...s,
      players: basePlayers(s.baseFrame),
      violations: [],
      trend: "same",
      checking: false,
    };
    stateRef.current = next;
    setState(next);
    setNotice(null);
  }, [cancelPreview]);

  const submit = useCallback(
    (auto = false) => {
      const s = stateRef.current;
      if (!s || s.status !== "open") return;
      cancelPreview();
      const submission: ChallengeSubmission = {
        matchId: s.matchId,
        eventUuid: s.eventUuid,
        team: s.team,
        moves: movesOf(s.players),
        auto,
        submittedAt: Date.now(),
      };
      const next: ChallengeState = { ...s, status: "submitted", checking: false, submission };
      stateRef.current = next;
      setState(next);
      setNotice(null);
      onSubmitRef.current?.(submission);
    },
    [cancelPreview]
  );

  const close = useCallback(() => {
    cancelPreview();
    stateRef.current = null;
    setState(null);
    setNotice(null);
  }, [cancelPreview]);

  // Clock: ticks while open and auto-submits at 0 s.
  const isOpen = state?.status === "open";
  const deadline = state?.deadline ?? 0;
  useEffect(() => {
    if (!isOpen) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) submit(true);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [isOpen, deadline, submit]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  const secondsLeft = state
    ? state.status === "open"
      ? Math.max(0, Math.ceil((state.deadline - now) / 1000))
      : Math.max(0, Math.ceil((state.deadline - (state.submission?.submittedAt ?? now)) / 1000))
    : 0;

  return {
    state,
    secondsLeft,
    notice,
    flashNotice,
    open,
    isChallengeOpen,
    applyMoves,
    canMove,
    move,
    drop,
    reset,
    submit,
    close,
  };
}

export type ChallengeController = ReturnType<typeof useChallenge>;

export default useChallenge;
