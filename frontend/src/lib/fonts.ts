import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";

/** Condensed broadcast face for headlines, names, numerals and lower-thirds. */
export const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

/** UI face for controls and body copy. */
export const sansFont = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/** Data face for metric labels and telemetry. */
export const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
