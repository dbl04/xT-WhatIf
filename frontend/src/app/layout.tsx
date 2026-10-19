import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PitchGhost-360 | Interactive Tactical Counterfactual Engine",
  description:
    "Explore football counterfactual scenarios on StatsBomb 360 freeze-frames. Real-time xT calculation, Voronoi dominance, and multi-agent AI debates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-emerald-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
