"use client";

import { useSyncExternalStore } from "react";

/**
 * Challenge sound effects: short tones synthesised with Web Audio, no audio files.
 * The AudioContext is created on the first pointer or key press (browsers block audio
 * before a user gesture) and the mute choice is remembered per browser.
 */
const STORAGE_KEY = "xt-whatif:sfx-muted";
const VOLUME = 0.12;

let ctx: AudioContext | null = null;
let muted = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {}
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

interface Tone {
  freq: number;
  /** Start offset and length in seconds. */
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Frequency the tone glides to by its end. */
  to?: number;
}

function play(tones: Tone[]) {
  if (muted || !ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  for (const { freq, at = 0, dur, type = "sine", gain = 1, to } of tones) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + at);
    if (to) osc.frequency.linearRampToValueAtTime(to, t0 + at + dur);
    // Short attack and exponential release: no clicks.
    amp.gain.setValueAtTime(0.0001, t0 + at);
    amp.gain.exponentialRampToValueAtTime(VOLUME * gain, t0 + at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.02);
  }
}

export const sfx = {
  /** A moment opens or time is up: two short referee-style blasts. */
  whistle: () =>
    play([
      { freq: 2400, dur: 0.12, gain: 0.5 },
      { freq: 2400, at: 0.16, dur: 0.28, gain: 0.5 },
    ]),
  /** Each of the last seconds; higher for the final three. */
  tick: (secondsLeft: number) => play([{ freq: secondsLeft <= 3 ? 1320 : 880, dur: 0.05, type: "square", gain: 0.35 }]),
  /** A player is dropped on the board. */
  drop: () => play([{ freq: 420, to: 300, dur: 0.07, type: "triangle", gain: 0.8 }]),
  /** A grab that the rules do not allow. */
  blocked: () => play([{ freq: 160, dur: 0.14, type: "square", gain: 0.4 }]),
  /** Moves confirmed. */
  confirm: () =>
    play([
      { freq: 660, dur: 0.08, type: "triangle" },
      { freq: 990, at: 0.08, dur: 0.12, type: "triangle" },
    ]),
  /** Reveal: rising notes for a good answer, falling ones otherwise. */
  reveal: (good: boolean) =>
    play(
      (good ? [523, 659, 784] : [392, 311]).map((freq, i) => ({ freq, at: i * 0.11, dur: 0.18, type: "triangle" as const }))
    ),
};

function setMuted(next: boolean) {
  muted = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mute state for the header toggle. */
export function useSfxMuted(): [boolean, (muted: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => muted, () => false);
  return [value, setMuted];
}
