import type { MatchFramePayload, PlayerNode, TeamSide } from "@/types/match";
import { API_BASE_URL } from "@/lib/api";
import { STATSBOMB_PITCH_LENGTH, STATSBOMB_PITCH_WIDTH } from "@/lib/coordinates";

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
  signal?: AbortSignal
): Promise<PreviewResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/game/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PreviewResponse;
}
