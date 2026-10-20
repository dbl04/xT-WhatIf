import type { Config } from "tailwindcss";

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
          DEFAULT: "#0b0214", // page background (deep plum)
          900: "#110322", // docks, panels
          800: "#1a0832", // raised controls
          700: "#26103f", // hover / pressed
        },
        line: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          strong: "rgba(255, 255, 255, 0.16)",
        },
        fg: {
          DEFAULT: "#f4f0f8",
          muted: "#a99bbd",
          subtle: "#6e6283",
        },
        signal: {
          green: "#00ff85", // danger created / positive xT
          magenta: "#ff005a", // losses / negative xT
        },
        turf: {
          DEFAULT: "#081f14",
          stripe: "#0a2418",
        },
        team: {
          home: "#75aadb", // Argentina celeste
          away: "#f4f0f8", // France (white kit on the plum broadcast)
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
