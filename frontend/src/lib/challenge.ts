import type { MatchFramePayload, PlayerNode, TeamSide } from "@/types/match";
import type { Audience, Language } from "@/lib/i18n";
import type { MomentReveal } from "@/hooks/useLiveMatch";
import { API_BASE_URL } from "@/lib/api";
import { STATSBOMB_PITCH_LENGTH, STATSBOMB_PITCH_WIDTH } from "@/lib/coordinates";
import { offlineCounterfactualDebate } from "@/lib/offlineNarration";
import { xtAt } from "@/lib/xt";

/**
 * xT Live Challenge: rules of a key moment and the preview call.
 * Mirrors backend/app/services/game_engine.py (movement rules) and game_api.py
 * (POST /api/v1/game/preview). The client copy of the rules is only the offline fallback:
 * when the backend answers, its movable players, rules and violations win.
 */
export type ChallengeMode = "attack" | "defend";
export type ChallengeTrend = "better" | "worse" | "same";
export type ViolationRule =
  | "too_far"
  | "too_many"
  | "not_movable"
  | "off_pitch"
  | "too_close"
  | "offside"
  | "unknown_player";

export interface ChallengeRules {
  max_players: number;
  max_radius_m: number;
  min_spacing_m: number;
  /** Attack only: attackers who start onside may not cross this x. */
  offside_line_x: number | null;
}

export interface ChallengeViolation {
  player_id: number;
  rule: ViolationRule;
  detail: string;
}

export interface ChallengeMove {
  player_id: number;
  x: number;
  y: number;
}

export interface PreviewResponse {
  mode: ChallengeMode;
  movable_player_ids: number[];
  rules: ChallengeRules;
  legal: boolean;
  violations: ChallengeViolation[];
  trend: ChallengeTrend;
}

export const DEFAULT_RULES: Omit<ChallengeRules, "offside_line_x"> = {
  max_players: 2,
  max_radius_m: 6.0,
  min_spacing_m: 1.8,
};

/** Seconds the user has to move players in a key moment. */
export const CHALLENGE_DURATION_S = 30;
/** Last seconds shown in the urgency colour. */
export const CHALLENGE_URGENT_S = 10;

const EPS = 0.05;

/** Your team has the ball: attack. The rival has it: defend. */
export function modeFor(team: TeamSide, frame: MatchFramePayload): ChallengeMode {
  return team === frame.possession_team ? "attack" : "defend";
}

const origin = (p: PlayerNode) => ({ x: p.original_x ?? p.x, y: p.original_y ?? p.y });

function carrier(frame: MatchFramePayload): PlayerNode | undefined {
  const actor = frame.players.find((p) => p.is_actor);
  if (actor) return actor;
  const mates = frame.players.filter((p) => p.team === frame.possession_team);
  const pool = mates.length ? mates : frame.players;
  return pool.reduce<PlayerNode | undefined>((best, p) => {
    const d = Math.hypot(p.x - frame.ball_x, p.y - frame.ball_y);
    return !best || d < Math.hypot(best.x - frame.ball_x, best.y - frame.ball_y) ? p : best;
  }, undefined);
}

/** Attack: the carrier's outfield teammates (not the carrier). Defend: outfield defenders. */
export function movablePlayerIds(frame: MatchFramePayload, mode: ChallengeMode): number[] {
  const ballCarrier = carrier(frame);
  if (mode === "attack") {
    return frame.players
      .filter((p) => p.team === frame.possession_team && !p.is_keeper && p.player_id !== ballCarrier?.player_id)
      .map((p) => p.player_id);
  }
  return frame.players.filter((p) => p.team !== frame.possession_team && !p.is_keeper).map((p) => p.player_id);
}

/** max(second-last defender x, ball x, halfway), from the ORIGINAL positions. */
export function offsideLine(frame: MatchFramePayload): number {
  const defendersX = frame.players
    .filter((p) => p.team !== frame.possession_team)
    .map((p) => origin(p).x)
    .sort((a, b) => b - a);
  const secondLast = defendersX.length >= 2 ? defendersX[1] : STATSBOMB_PITCH_LENGTH;
  return Math.max(secondLast, frame.ball_x, STATSBOMB_PITCH_LENGTH / 2);
}

export function offlineRules(frame: MatchFramePayload, mode: ChallengeMode): ChallengeRules {
  return {
    ...DEFAULT_RULES,
    offside_line_x: mode === "attack" ? Number(offsideLine(frame).toFixed(1)) : null,
  };
}

/** Client-side copy of validate_moves (offline fallback and instant feedback). */
export function validateMovesOffline(
  frame: MatchFramePayload,
  mode: ChallengeMode,
  rules: ChallengeRules,
  movableIds: number[],
  moves: ChallengeMove[]
): ChallengeViolation[] {
  const byId = new Map(frame.players.map((p) => [p.player_id, p]));
  const movable = new Set(movableIds);
  const violations: ChallengeViolation[] = [];

  const movedIds = Array.from(new Set(moves.map((m) => m.player_id)));
  movedIds.slice(rules.max_players).forEach((pid) =>
    violations.push({ player_id: pid, rule: "too_many", detail: `at most ${rules.max_players} players may move` })
  );

  const final = new Map(moves.map((m) => [m.player_id, m]));
  const positions = frame.players.map((p) => {
    const m = final.get(p.player_id);
    const o = origin(p);
    return { id: p.player_id, x: m ? m.x : o.x, y: m ? m.y : o.y };
  });
  const line = mode === "attack" ? rules.offside_line_x : null;

  final.forEach(({ player_id: pid, x, y }) => {
    const p = byId.get(pid);
    if (!p) {
      violations.push({ player_id: pid, rule: "unknown_player", detail: "no such player in this moment" });
      return;
    }
    if (!movable.has(pid)) {
      violations.push({ player_id: pid, rule: "not_movable", detail: `this player cannot move in ${mode} mode` });
      return;
    }
    if (x < 0 || x > STATSBOMB_PITCH_LENGTH || y < 0 || y > STATSBOMB_PITCH_WIDTH) {
      violations.push({ player_id: pid, rule: "off_pitch", detail: "position outside the pitch" });
    }
    const o = origin(p);
    const dist = Math.hypot(x - o.x, y - o.y);
    if (dist > rules.max_radius_m + EPS) {
      violations.push({ player_id: pid, rule: "too_far", detail: `moved ${dist.toFixed(1)} m` });
    }
    const nearest = positions
      .filter((q) => q.id !== pid)
      .reduce((min, q) => Math.min(min, Math.hypot(x - q.x, y - q.y)), Infinity);
    if (nearest < rules.min_spacing_m - EPS) {
      violations.push({ player_id: pid, rule: "too_close", detail: `${nearest.toFixed(1)} m from another player` });
    }
    if (line != null && o.x <= line + EPS && x > line + EPS) {
      violations.push({ player_id: pid, rule: "offside", detail: `beyond the offside line at x = ${line.toFixed(1)}` });
    }
  });
  return violations;
}

/** Keeps (x, y) within `radius` of the origin and inside the pitch; rounded to 0.1 m like the backend. */
export function clampToRadius(
  ox: number,
  oy: number,
  x: number,
  y: number,
  radius: number
): { x: number; y: number } {
  let cx = x;
  let cy = y;
  const d = Math.hypot(x - ox, y - oy);
  // Slightly inside the limit so rounding never pushes the player over it.
  const limit = Math.max(0, radius - 0.06);
  if (d > limit && d > 0) {
    cx = ox + ((x - ox) / d) * limit;
    cy = oy + ((y - oy) / d) * limit;
  }
  cx = Math.max(0.5, Math.min(STATSBOMB_PITCH_LENGTH - 0.5, cx));
  cy = Math.max(0.5, Math.min(STATSBOMB_PITCH_WIDTH - 0.5, cy));
  return { x: Number(cx.toFixed(1)), y: Number(cy.toFixed(1)) };
}

/** POST /api/v1/game/preview. Throws on network errors or non-2xx answers. */
export async function fetchPreview(
  body: { match_id: number; event_uuid: string; team: TeamSide; moves: ChallengeMove[] },
  signal?: AbortSignal,
  baseUrl: string = API_BASE_URL
): Promise<PreviewResponse> {
  const res = await fetch(`${baseUrl}/api/v1/game/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PreviewResponse;
}

/**
 * Evaluates a user's challenge submission in Practice / Key Moments mode.
 * Calls POST /api/v1/game/evaluate on the backend and falls back to a deterministic
 * client-side evaluation if the backend is offline so the Reveal card always renders.
 */
export async function evaluateChallenge(
  body: {
    match_id: number;
    event_uuid: string;
    team: TeamSide;
    moves: ChallengeMove[];
    language: Language;
    audience: Audience;
  },
  frame: MatchFramePayload,
  baseUrl: string = API_BASE_URL
): Promise<MomentReveal> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/game/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return (await res.json()) as MomentReveal;
    }
  } catch {
    // Fall back to deterministic offline evaluation below.
  }

  const mode = modeFor(body.team, frame);
  const movable = movablePlayerIds(frame, mode);
  const beforePct = Math.round(frame.metrics.original_xt * 100);

  // Build a deterministic machine optimum on the first 2 movable players
  const optimumMoves: ChallengeMove[] = movable.slice(0, 2).map((pid, idx) => {
    const p = frame.players.find((pl) => pl.player_id === pid);
    if (!p) return { player_id: pid, x: 60, y: 40 };
    const dx = mode === "attack" ? 4.2 : (frame.ball_x - p.x) * 0.35;
    const dy = mode === "attack" ? (idx === 0 ? -2.8 : 2.8) : (frame.ball_y - p.y) * 0.35;
    const clamped = clampToRadius(p.original_x ?? p.x, p.original_y ?? p.y, p.x + dx, p.y + dy, 6.0);
    return { player_id: pid, x: clamped.x, y: clamped.y };
  });

  const bestPct =
    mode === "attack"
      ? Math.min(92, Math.max(beforePct + 8, Math.round(beforePct * 1.32)))
      : Math.max(4, Math.min(beforePct - 6, Math.round(beforePct * 0.65)));

  // Score the user's moves by proximity to the optimum and tactical improvement
  let userScore = 360;
  let yoursPct = beforePct;
  if (body.moves.length > 0) {
    let totalBonus = 0;
    for (const m of body.moves) {
      const orig = frame.players.find((p) => p.player_id === m.player_id);
      if (!orig) continue;
      if (mode === "attack") {
        const cellDiff = xtAt(m.x, m.y) - xtAt(orig.x, orig.y);
        totalBonus += Math.max(-4, Math.min(10, Math.round(cellDiff * 140)));
      } else {
        const dBefore = Math.hypot(orig.x - frame.ball_x, orig.y - frame.ball_y);
        const dAfter = Math.hypot(m.x - frame.ball_x, m.y - frame.ball_y);
        totalBonus += Math.max(-4, Math.min(9, Math.round((dBefore - dAfter) * 1.4)));
      }
    }
    yoursPct =
      mode === "attack"
        ? Math.max(2, Math.min(95, beforePct + Math.max(1, totalBonus)))
        : Math.max(2, Math.min(95, beforePct - Math.max(1, totalBonus)));
    const denom = Math.max(1, Math.abs(bestPct - beforePct));
    const ratio =
      mode === "attack"
        ? Math.max(0, Math.min(1.08, (yoursPct - beforePct) / denom))
        : Math.max(0, Math.min(1.08, (beforePct - yoursPct) / denom));
    userScore = Math.min(1000, Math.max(180, Math.round(ratio * 920)));
  }

  const movedPlayers = body.moves
    .map((m) => frame.players.find((p) => p.player_id === m.player_id))
    .filter((p): p is PlayerNode => Boolean(p));
  const actor = frame.players.find((p) => p.is_actor) || frame.players[0];
  const delta = Number(((yoursPct - beforePct) / 100).toFixed(2));
  const pundits = offlineCounterfactualDebate(frame, body.language, {
    modifiedNames: movedPlayers.map((p) => p.name).join(", "),
    modifiedIds: movedPlayers.map((p) => p.player_id),
    actorId: actor.player_id,
    delta,
    simXt: yoursPct / 100,
    passProb: frame.metrics.pass_completion_prob,
    audience: body.audience,
  });

  const isEs = body.language === "es";
  const voronoiMsg = pundits[0];
  const bianchiMsg = pundits[1];

  return {
    moment_id: `practice-${frame.event_uuid}`,
    mode,
    optimum_moves: optimumMoves,
    optimum_target_id: frame.metrics.optimal_pass_target_id ?? null,
    base_target_id: frame.metrics.optimal_pass_target_id ?? null,
    your_moves: body.moves,
    your_score: userScore,
    beat_machine: userScore >= 950,
    goal_chance_pct: {
      before: beforePct,
      best: bestPct,
      yours: yoursPct,
    },
    explanation: {
      headline: voronoiMsg?.headline ?? (isEs ? "Resultado de la jugada" : "Play result"),
      body: bianchiMsg?.analysis_body ?? "",
      voronoi_comparison: voronoiMsg?.analysis_body ?? "",
      bianchi_headline: bianchiMsg?.headline ?? "",
      personal: voronoiMsg?.analysis_body ?? "",
      voronoi_voice: voronoiMsg?.analysis_body ?? "",
      bianchi_voice: bianchiMsg?.analysis_body ?? "",
      community: isEs
        ? `Tu jugada sumó ${userScore} pts en modo práctica.`
        : `Your move scored ${userScore} pts in practice mode.`,
    },
    pundits,
    community: {
      submissions: 1,
      found_it_pct: userScore >= 700 ? 100 : 42,
      avg_score: userScore,
    },
  };
}
