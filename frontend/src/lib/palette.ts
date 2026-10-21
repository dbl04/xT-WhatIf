/**
 * Broadcast palette — single source of truth for Tailwind tokens and for
 * colours that must be inlined (SVG pitch, canvas PNG export).
 */
export const PALETTE = {
  ink: "#0b0214", // page background (deep plum)
  ink900: "#110322", // docks, panels
  ink800: "#1a0832", // raised controls
  ink700: "#26103f", // hover / pressed
  fg: "#f4f0f8",
  fgMuted: "#a99bbd",
  fgSubtle: "#6e6283",
  line: "rgba(255, 255, 255, 0.08)",
  lineStrong: "rgba(255, 255, 255, 0.16)",
  green: "#00ff85", // danger created / positive xT
  magenta: "#ff005a", // losses / negative xT
  turf: "#081f14",
  turfStripe: "#0a2418",
  pitchLine: "rgba(255, 255, 255, 0.72)",
  home: "#75aadb", // home club kit (celeste)
  away: "#f4f0f8", // away club kit (white on the plum broadcast)
} as const;

/** SVG hairline: stays `px` screen pixels wide regardless of pitch zoom. */
export const hair = (px = 0.5) => ({
  vectorEffect: "non-scaling-stroke" as const,
  strokeWidth: px,
});
