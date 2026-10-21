import type { Config } from "tailwindcss";
import { PALETTE } from "./src/lib/palette";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Broadcast editorial palette (Premier League / MNF inspired)
        ink: {
          DEFAULT: PALETTE.ink,
          900: PALETTE.ink900,
          800: PALETTE.ink800,
          700: PALETTE.ink700,
        },
        line: {
          DEFAULT: PALETTE.line,
          strong: PALETTE.lineStrong,
        },
        fg: {
          DEFAULT: PALETTE.fg,
          muted: PALETTE.fgMuted,
          subtle: PALETTE.fgSubtle,
        },
        signal: {
          green: PALETTE.green,
          magenta: PALETTE.magenta,
        },
        turf: {
          DEFAULT: PALETTE.turf,
          stripe: PALETTE.turfStripe,
        },
        team: {
          home: PALETTE.home,
          away: PALETTE.away,
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Arial Narrow", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "progress-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        "progress-indeterminate": "progress-indeterminate 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
