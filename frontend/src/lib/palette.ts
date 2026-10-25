/**
 * Broadcast palette — single source of truth for Tailwind tokens and for
 * colours that must be inlined (SVG pitch, canvas PNG export).
 */
export const PALETTE = {
  ink: "#070b14", // page background (midnight navy)
  ink900: "#0c1220", // docks, panels
  ink800: "#141c2e", // raised controls
  ink700: "#1e2940", // hover / pressed
  fg: "#eef1f6",
  fgMuted: "#9ba5b8",
  fgSubtle: "#667089",
  line: "rgba(255, 255, 255, 0.08)",
  lineStrong: "rgba(255, 255, 255, 0.16)",
  // Volt and flare rather than the mint-on-purple of a certain league's broadcasts.
  gain: "#c8f031", // danger created / positive xT
  loss: "#ff7a3c", // losses / negative xT
  red: "#ff3b30", // challenge rule broken (player ring)
  turf: "#081f14",
  turfStripe: "#0a2418",
  pitchLine: "rgba(255, 255, 255, 0.72)",
  home: "#75aadb", // home club kit (celeste)
  away: "#f4f0f8", // away club kit (white), from the synthetic fixture
} as const;

/** `#rrggbb` at the given opacity, for fills that need a translucent palette colour. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** SVG hairline: stays `px` screen pixels wide regardless of pitch zoom. */
export const hair = (px = 0.5) => ({
  vectorEffect: "non-scaling-stroke" as const,
  strokeWidth: px,
});
