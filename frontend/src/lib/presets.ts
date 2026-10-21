"use strict";

import { MatchFramePayload, PlayerNode } from "@/types/match";
import { DEFAULT_LANGUAGE, Translate, translate } from "@/lib/i18n";

export interface TacticalPreset {
  id: string;
  label: string;
  playerId: number;
  targetX: number;
  targetY: number;
}

const round1 = (v: number) => Number(v.toFixed(1));
const clampX = (v: number) => Math.min(119, Math.max(1, v));
const clampY = (v: number) => Math.min(79, Math.max(1, v));
const surname = (p: PlayerNode) => p.name.split(" ").pop() ?? p.name;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/**
 * Three contextual "what if" moves computed from any frame (no hand-picked plays):
 * 1. The nearest defender presses the ball carrier.
 * 2. The defender closest to the ball's path steps into the lane.
 * 3. The intended receiver attacks the space behind the line.
 * Every move stays within the 6 m inertia radius.
 */
export function getPresetsForFrame(
  frame: MatchFramePayload,
  t: Translate = (key, vars) => translate(DEFAULT_LANGUAGE, key, vars)
): TacticalPreset[] {
  if (!frame || !frame.players || frame.players.length === 0) {
    return [];
  }

  const { players, ball_x, ball_y, metrics } = frame;
  const endX = frame.ball_end_x ?? ball_x;
  const endY = frame.ball_end_y ?? ball_y;

  const actor = players.find((p) => p.is_actor) || players[0];
  const defenders = players.filter((p) => p.team !== actor.team && !p.is_keeper);
  const teammates = players.filter(
    (p) => p.team === actor.team && p.player_id !== actor.player_id && !p.is_keeper
  );

  const presets: TacticalPreset[] = [];

  // 1. Press the carrier: close 3.5 m towards the ball.
  const presser = [...defenders].sort(
    (a, b) => dist(a.x, a.y, ball_x, ball_y) - dist(b.x, b.y, ball_x, ball_y)
  )[0];
  if (presser) {
    const d = dist(presser.x, presser.y, ball_x, ball_y) || 1;
    const step = Math.min(3.5, Math.max(0, d - 1.2));
    presets.push({
      id: `press_${presser.player_id}`,
      label: t("preset.press", { name: surname(presser) }),
      playerId: presser.player_id,
      targetX: round1(clampX(presser.x + ((ball_x - presser.x) / d) * step)),
      targetY: round1(clampY(presser.y + ((ball_y - presser.y) / d) * step)),
    });
  }

  // 2. Cut the lane: the next defender moves onto the midpoint of the ball's path (max 5.5 m).
  const midX = (ball_x + endX) / 2;
  const midY = (ball_y + endY) / 2;
  const cutter = defenders
    .filter((p) => p.player_id !== presser?.player_id)
    .sort((a, b) => dist(a.x, a.y, midX, midY) - dist(b.x, b.y, midX, midY))[0];
  if (cutter && dist(ball_x, ball_y, endX, endY) > 2) {
    const d = dist(cutter.x, cutter.y, midX, midY) || 1;
    const step = Math.min(5.5, d);
    presets.push({
      id: `cut_${cutter.player_id}`,
      label: t("preset.cut", { name: surname(cutter) }),
      playerId: cutter.player_id,
      targetX: round1(clampX(cutter.x + ((midX - cutter.x) / d) * step)),
      targetY: round1(clampY(cutter.y + ((midY - cutter.y) / d) * step)),
    });
  }

  // 3. Run in behind: the receiver (or best option) attacks 5 m of space towards goal.
  const receiver =
    [...teammates].sort((a, b) => dist(a.x, a.y, endX, endY) - dist(b.x, b.y, endX, endY))[0] ||
    teammates.find((p) => p.player_id === metrics?.optimal_pass_target_id);
  if (receiver) {
    presets.push({
      id: `run_${receiver.player_id}`,
      label: t("preset.run", { name: surname(receiver) }),
      playerId: receiver.player_id,
      targetX: round1(clampX(receiver.x + 5.0)),
      targetY: round1(clampY(receiver.y + (40 - receiver.y) * 0.15)),
    });
  }

  return presets;
}
