"use client";

import React from "react";
import { useFanSession } from "@/components/onboarding/OnboardingGate";
import { useI18n } from "@/lib/i18n";

/** Header chip with the fan's nickname and team; opens team selection / profile editing. */
export const FanBadge: React.FC = () => {
  const session = useFanSession();
  const { t } = useI18n();
  if (!session) return null;
  const { identity, teamInfo, openTeamSelection } = session;
  const label = t("fan.badgeTitle");

  return (
    <button
      type="button"
      onClick={openTeamSelection}
      title={`${identity.nickname} · ${teamInfo.name}. ${label}`}
      aria-label={`${identity.nickname} · ${teamInfo.name}. ${label}`}
      className="flex h-8 max-w-[11rem] items-center gap-1.5 rounded-md border border-line bg-ink-800 px-2 transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal-gain"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
        style={{ backgroundColor: teamInfo.primary_color }}
        aria-hidden
      />
      {/* Nickname hidden at xl, where the fixture line already competes for header space. */}
      <span className="hidden truncate text-[12px] text-fg sm:inline xl:hidden 2xl:inline">{identity.nickname}</span>
      <span className="font-display text-[12px] font-bold uppercase tracking-wide text-fg-muted">
        {teamInfo.short_name}
      </span>
    </button>
  );
};

export default FanBadge;
