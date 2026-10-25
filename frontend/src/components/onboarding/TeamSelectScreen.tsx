"use client";

import React, { useState } from "react";
import { ArrowRight, Check, UserRound, Users } from "lucide-react";
import { Button, Kicker, Tag } from "@/components/ui/primitives";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { TeamCrest } from "@/components/onboarding/TeamCrest";
import { useI18n } from "@/lib/i18n";
import { mockFanCount } from "@/lib/fan";
import { cn } from "@/lib/utils";
import type { MatchInfo, TeamSide } from "@/types/match";

const SIDES: TeamSide[] = ["home", "away"];

/** Step 2: pick the team the fan supports for this match. */
export const TeamSelectScreen: React.FC<{
  matchId: number;
  matchInfo: MatchInfo;
  nickname: string;
  initialTeam: TeamSide | null;
  /** True when coming back from the dashboard: the button reads "Back to match". */
  isReturning: boolean;
  onEditProfile: () => void;
  onConfirm: (side: TeamSide) => void;
}> = ({ matchId, matchInfo, nickname, initialTeam, isReturning, onEditProfile, onConfirm }) => {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<TeamSide | null>(initialTeam);
  const numberFormat = new Intl.NumberFormat(locale);

  return (
    <OnboardingShell
      step={2}
      totalSteps={2}
      title={t("team.title")}
      description={t("team.desc")}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{t("team.greeting", { name: nickname })}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={onEditProfile}>
          {t("team.editProfile")}
        </Button>
      </div>

      <Kicker className="mb-2 block">
        {matchInfo.competition}
        {matchInfo.venue ? ` · ${matchInfo.venue}` : ""}
      </Kicker>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {SIDES.map((side) => {
          const team = matchInfo[side];
          const isSelected = selected === side;
          // MOCK counter (see mockFanCount): deterministic baseline + 1 for the user's pick.
          const fans = mockFanCount(matchId, matchInfo.seed, side) + (isSelected ? 1 : 0);
          return (
            <button
              key={side}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(side)}
              className={cn(
                "group relative flex flex-col items-center overflow-hidden rounded-lg border bg-ink-900 px-4 pb-5 pt-6 text-center transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-gain",
                isSelected
                  ? "border-signal-gain shadow-[0_0_0_1px_rgba(200,240,49,0.5),0_16px_48px_rgba(0,0,0,0.45)]"
                  : "border-line-strong hover:border-fg-subtle hover:bg-ink-800"
              )}
            >
              {/* Kit colour stripe */}
              <span
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ backgroundColor: team.primary_color }}
                aria-hidden
              />
              <span className="absolute left-3 top-4">
                <Kicker>{side === "home" ? t("team.home") : t("team.away")}</Kicker>
              </span>
              {isSelected && (
                <span className="absolute right-3 top-3.5">
                  <Tag tone="green">
                    <Check className="h-3 w-3" aria-hidden />
                    {t("team.yourTeam")}
                  </Tag>
                </span>
              )}

              <TeamCrest
                color={team.primary_color}
                shortName={team.short_name}
                className="mt-4 h-24 w-20 drop-shadow-[0_8px_18px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-[1.03] sm:h-32 sm:w-28"
              />

              <span className="mt-4 font-display text-3xl font-bold uppercase leading-none tracking-tight text-fg sm:text-4xl">
                {team.name}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <Tag>{team.short_name}</Tag>
                <span
                  className="h-3 w-3 rounded-full border border-white/20"
                  style={{ backgroundColor: team.primary_color }}
                  aria-hidden
                />
              </span>
              <span className="mt-4 flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-fg-muted">
                <Users className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
                {t(fans === 1 ? "team.fans.one" : "team.fans.other", { n: numberFormat.format(fans) })}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col items-stretch gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
        <p className="text-center text-[12px] text-fg-subtle sm:text-right" aria-live="polite">
          {selected ? "" : t("team.pickFirst")}
        </p>
        <Button
          variant="primary"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
          className="h-11 px-6 text-sm"
        >
          {isReturning ? t("team.resume") : t("team.start")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </OnboardingShell>
  );
};

export default TeamSelectScreen;
