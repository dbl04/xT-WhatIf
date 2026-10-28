import type { Metadata } from "next";
import Script from "next/script";
import { displayFont, sansFont, monoFont } from "@/lib/fonts";
import { I18nProvider } from "@/lib/i18n";
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
      lang="en"
      className={`dark ${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body className="bg-ink text-fg min-h-screen antialiased">
        {/* Backend URLs from the container's runtime environment (app/runtime-config.js).
            beforeInteractive runs it before any app code, so lib/api.ts always sees it. */}
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
