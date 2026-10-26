"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEventSummary, LiveState, MatchEnd } from "@/hooks/useLiveMatch";
import type { ChallengeMode, ChallengeMove } from "@/lib/challenge";
import type { MatchFramePayload, MatchInfo } from "@/types/match";

/** The key moment where the fan's move did the most for their team. */
export interface BestMoment {
  momentId: string;
  frame: MatchFramePayload;
  event: LiveEventSummary;
  mode: ChallengeMode;
  yourMoves: ChallengeMove[];
  optimumMoves: ChallengeMove[];
  optimumTargetId: number | null;
  /** Threat of the action (goal chance, %) before any move, after the fan's move and at the optimum. */
  before: number;
  yours: number;
  best: number;
  score: number;
  /** Threat the fan added (attack) or took away (defend), in percentage points. */
  gain: number;
}

/** What the full-time report shows: the final result, the fan's position and their best moment. */
export interface FullTimeSnapshot {
  end: MatchEnd;
  matchInfo: MatchInfo;
  best: BestMoment | null;
}

function gainOf(mode: ChallengeMode, before: number, yours: number): number {
  return mode === "attack" ? yours - before : before - yours;
}

/**
 * Follows the live match: keeps the fan's best scored moment and, at full time, freezes it with
 * the final leaderboard. The snapshot stays available after the next kick-off, until the next
 * full time replaces it.
 */
export function useFullTimeReport(live: LiveState): FullTimeSnapshot | null {
  const bestRef = useRef<BestMoment | null>(null);
  const [snapshot, setSnapshot] = useState<FullTimeSnapshot | null>(null);

  // Every scored reveal competes for the best moment of this match.
  const { reveal, moment } = live;
  useEffect(() => {
    if (!reveal || !moment || reveal.moment_id !== moment.moment_id) return;
    const { before, yours, best } = reveal.goal_chance_pct;
    if (reveal.your_score == null || yours == null) return;
    const gain = gainOf(reveal.mode, before, yours);
    const current = bestRef.current;
    if (current && (current.momentId === reveal.moment_id || gain < current.gain)) return;
    if (current && gain === current.gain && reveal.your_score <= current.score) return;
    bestRef.current = {
      momentId: reveal.moment_id,
      frame: moment.frame,
      event: moment.event,
      mode: reveal.mode,
      yourMoves: reveal.your_moves,
      optimumMoves: reveal.optimum_moves,
      optimumTargetId: reveal.optimum_target_id,
      before,
      yours,
      best,
      score: reveal.your_score,
      gain,
    };
  }, [reveal, moment]);

  // Full time freezes the report; the next kick-off starts a new best moment.
  const { matchEnd, matchInfo } = live;
  const hadEnd = useRef(false);
  useEffect(() => {
    if (matchEnd && matchInfo) {
      hadEnd.current = true;
      setSnapshot({ end: matchEnd, matchInfo, best: bestRef.current });
    } else if (!matchEnd && hadEnd.current) {
      hadEnd.current = false;
      bestRef.current = null;
    }
  }, [matchEnd, matchInfo]);

  return snapshot;
}
