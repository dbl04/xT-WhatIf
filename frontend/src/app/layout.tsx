import type { Metadata } from "next";
import { displayFont, sansFont, monoFont } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "xT-WhatIf | Interactive Tactical Counterfactual Engine",
  description:
    "Explore football counterfactual scenarios on synthetic 360-style freeze-frames. Real-time xT calculation, Voronoi dominance, and multi-agent AI debates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`dark ${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}
    >
      <body className="bg-ink text-fg min-h-screen antialiased">{children}</body>
    </html>
  );
}
