import type { TeamSide } from "@/types/match";

/**
 * Anonymous fan identity for the xT Live Challenge: no login and no backend call.
 * Language and audience live in the i18n profile (`xt-whatif.profile`, see i18n.tsx);
 * the nickname / anonymous id and the team chosen for each match are stored here.
 * Every storage access is wrapped so the app keeps working when storage is blocked.
 */
export interface FanIdentity {
  userId: string;
  nickname: string;
}

export const FAN_STORAGE_KEY = "xt-whatif.fan";
export const TEAM_STORAGE_PREFIX = "xt-whatif.team.";

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

export type NicknameError = "tooShort" | "tooLong" | null;

/** Trimmed, with inner runs of whitespace collapsed to one space. */
export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function validateNickname(raw: string): NicknameError {
  const nickname = normalizeNickname(raw);
  if (nickname.length < NICKNAME_MIN) return "tooShort";
  if (nickname.length > NICKNAME_MAX) return "tooLong";
  return null;
}

/** RFC 4122 v4 id; falls back to Math.random where crypto.randomUUID is unavailable (http, old browsers). */
export function generateUserId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual generator.
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function readFanIdentity(): FanIdentity | null {
  try {
    const raw = window.localStorage.getItem(FAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.userId !== "string" || typeof parsed?.nickname !== "string") return null;
    if (validateNickname(parsed.nickname)) return null;
    return { userId: parsed.userId, nickname: normalizeNickname(parsed.nickname) };
  } catch {
    return null;
  }
}

export function writeFanIdentity(identity: FanIdentity): void {
  try {
    window.localStorage.setItem(FAN_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Storage blocked: the profile lasts for this session only.
  }
}

export function readChosenTeam(matchId: number): TeamSide | null {
  try {
    const raw = window.localStorage.getItem(`${TEAM_STORAGE_PREFIX}${matchId}`);
    return raw === "home" || raw === "away" ? raw : null;
  } catch {
    return null;
  }
}

export function writeChosenTeam(matchId: number, side: TeamSide): void {
  try {
    window.localStorage.setItem(`${TEAM_STORAGE_PREFIX}${matchId}`, side);
  } catch {
    // Storage blocked: the choice lasts for this session only.
  }
}

/**
 * MOCK fan counters. These are NOT real numbers: a deterministic value in [600, 2600)
 * derived from the match id, the generator seed and the side, so every visitor sees the
 * same baseline. The caller adds +1 on the side the user picked.
 * TODO: read the live per-team fan counts from the backend once the endpoint exists.
 */
export function mockFanCount(matchId: number, seed: number | null | undefined, side: TeamSide): number {
  const key = `${matchId}:${seed ?? 0}:${side}`;
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 600 + ((hash >>> 0) % 2000);
}
