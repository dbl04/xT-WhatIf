"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatchFramePayload, PlayerNode } from "@/types/match";
import type { MomentReveal } from "@/hooks/useLiveMatch";

/**
 * Reveal replay: the board switches between the fan's shape and the optimum's, the players
 * gliding from one to the other, and on the optimum the ball then travels to its receiver.
 * Shortly after the reveal arrives it plays once on its own (your shape → the best one).
 */
export type ReplayView = "yours" | "best";

const GLIDE_MS = 700;
const AUTO_PLAY_DELAY_MS = 900;

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function applyMoves(players: PlayerNode[], moves: MomentReveal["optimum_moves"]): PlayerNode[] {
  const byId = new Map(moves.map((m) => [m.player_id, m]));
  return players.map((p) => {
    const m = byId.get(p.player_id);
    if (!m) return p;
    return { ...p, x: m.x, y: m.y, original_x: p.original_x ?? p.x, original_y: p.original_y ?? p.y, is_modified: true };
  });
}

export function useRevealReplay(reveal: MomentReveal | null, baseFrame: MatchFramePayload | null, yourPlayers: PlayerNode[] | null) {
  const [view, setViewState] = useState<ReplayView>("yours");
  const [shown, setShown] = useState<PlayerNode[] | null>(null);
  const [passing, setPassing] = useState(false);
  const shownRef = useRef<PlayerNode[] | null>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentId = reveal?.moment_id ?? null;

  const bestPlayers = useMemo(
    () => (reveal && baseFrame ? applyMoves(baseFrame.players, reveal.optimum_moves) : null),
    [reveal, baseFrame]
  );
  const target = view === "best" ? bestPlayers : yourPlayers;
  const yoursRef = useRef(yourPlayers);
  yoursRef.current = yourPlayers;

  // New reveal: start from the fan's shape and play the optimum once.
  useEffect(() => {
    setViewState("yours");
    setPassing(false);
    shownRef.current = yoursRef.current;
    setShown(null);
    if (!momentId) return;
    const id = setTimeout(() => setViewState("best"), AUTO_PLAY_DELAY_MS);
    return () => {
      clearTimeout(id);
      if (replayTimer.current) clearTimeout(replayTimer.current);
    };
  }, [momentId]);

  // Glide the players towards the selected shape, then pass on the optimum.
  useEffect(() => {
    if (!target) return;
    const from = shownRef.current ?? target;
    const fromById = new Map(from.map((p) => [p.player_id, p]));
    const done = () => {
      shownRef.current = target;
      setShown(target);
      if (view === "best") setPassing(true);
    };
    setPassing(false);
    if (reducedMotion() || from === target) return done();
    let raf = 0;
    const start = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - start) / GLIDE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const frame = target.map((p) => {
        const a = fromById.get(p.player_id) ?? p;
        return { ...p, x: a.x + (p.x - a.x) * e, y: a.y + (p.y - a.y) * e };
      });
      shownRef.current = frame;
      setShown(frame);
      if (k < 1) raf = requestAnimationFrame(step);
      else done();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, view]);

  /** Where the optimum's pass goes: its receiver in the optimum's shape. */
  const passTo = useMemo(() => {
    const id = reveal?.optimum_target_id;
    const receiver = id != null ? bestPlayers?.find((p) => p.player_id === id) : undefined;
    return receiver ? { x: receiver.x, y: receiver.y } : null;
  }, [reveal?.optimum_target_id, bestPlayers]);

  const setView = useCallback((next: ReplayView) => setViewState(next), []);
  /** Plays the optimum again from the fan's shape. */
  const replay = useCallback(() => {
    setPassing(false);
    setViewState("yours");
    if (replayTimer.current) clearTimeout(replayTimer.current);
    replayTimer.current = setTimeout(() => setViewState("best"), GLIDE_MS + 150);
  }, []);
  const endPass = useCallback(() => setPassing(false), []);

  return {
    view,
    setView,
    replay,
    /** Players to draw while a reveal is on screen (null: no reveal). */
    players: reveal ? shown ?? target : null,
    passing: passing && !!passTo,
    passTo,
    endPass,
  };
}
