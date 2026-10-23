import type { Metadata } from "next";
import { displayFont, sansFont, monoFont } from "@/lib/fonts";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

// Backend URLs are read from the container's environment on every request (see lib/api.ts),
// so the same image works before and after the backend's address is known.
export const dynamic = "force-dynamic";

function runtimeConfigScript(): string {
  const config = {
    apiUrl: process.env.API_URL || undefined,
    wsUrl: process.env.WS_URL || undefined,
    liveApiUrl: process.env.LIVE_API_URL || undefined,
    liveWsUrl: process.env.LIVE_WS_URL || undefined,
  };
  // "<" escaped so the values can never close the script tag.
  return `window.__XT_CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")};`;
}

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
      lang="en"
      className={`dark ${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript() }} />
      </head>
      <body className="bg-ink text-fg min-h-screen antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
