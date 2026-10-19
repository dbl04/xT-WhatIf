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
        pitch: {
          dark: "#0b1510",
          grass: "#122a1b",
          line: "rgba(255, 255, 255, 0.2)",
          accent: "#10b981",
        },
        tactical: {
          home: "#3b82f6", // Home team blue
          away: "#ef4444", // Away team red
          ghost: "#ec4899", // Counterfactual ghost pink
          optimal: "#10b981", // Best pass lane green
          obstructed: "#f59e0b", // Obstructed lane amber
        },
      },
    },
  },
  plugins: [],
};

export default config;
