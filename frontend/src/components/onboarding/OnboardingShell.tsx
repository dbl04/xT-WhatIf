"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Kicker } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n";

/** Shared frame of the pre-match screens: broadcast header, step counter and a titled panel. */
export const OnboardingShell: React.FC<{
  step: number;
  totalSteps: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ step, totalSteps, title, description, children }) => {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Move focus to the new screen's heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-screen w-full flex-col bg-ink text-fg">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-4 sm:px-5">
        <div className="flex items-baseline gap-0.5 font-display text-[22px] font-extrabold uppercase leading-none tracking-tight">
          <span className="text-fg">xT</span>
          <span className="text-signal-green">/</span>
          <span className="text-fg">WhatIf</span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-subtle">
          {t("onboarding.step", { n: step, total: totalSteps })}
        </span>
      </header>

      <main className="flex flex-1 justify-center px-4 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full max-w-3xl"
        >
          <Kicker className="text-signal-green">{t("onboarding.kicker")}</Kicker>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 font-display text-4xl font-bold uppercase leading-none tracking-tight text-fg outline-none sm:text-5xl"
          >
            {title}
          </h1>
          {description && <p className="mt-3 max-w-xl text-[14px] text-fg-muted">{description}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
      </main>
    </div>
  );
};

export default OnboardingShell;
