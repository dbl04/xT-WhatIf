"use client";

import React, { useEffect, useState } from "react";
import { Award, Radio, Trophy, Users } from "lucide-react";
import { Button, Kicker, Tag } from "@/components/ui/primitives";
import { MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MatchInfo, TeamSide } from "@/types/match";
import type { Leaderboard, LiveEventSummary, LiveState, MatchEnd, MomentReveal } from "@/hooks/useLiveMatch";

const BADGE_KEYS: Record<string, MessageKey> = {
  beat_machine: "badge.beat_machine",
  wall: "badge.wall",
  visionary: "badge.visionary",
  player_of_the_match: "badge.player_of_the_match",
};

const clockLabel = (seconds: number) => {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}'`;
};

const TeamDot: React.FC<{ color?: string }> = ({ color }) => (
  <span className="h-2 w-2 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: color }} aria-hidden />
);

// ======================================================================
// LIVE STATUS — clock, score and the latest events
// ======================================================================
export const LiveStatusCard: React.FC<{
  live: LiveState;
  clockSeconds: number;
  matchInfo: MatchInfo;
  onPractice: () => void;
}> = ({ live, clockSeconds, matchInfo, onPractice }) => {
  const { t, language } = useI18n();
  const fans = live.leaderboard?.players ?? 0;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <Kicker className="flex items-center gap-1.5 text-signal-green">
          <Radio className="h-3 w-3 animate-pulse" aria-hidden />
          {t("live.kicker")}
        </Kicker>
        <span className="font-mono text-[10px] text-fg-subtle">
          <Users className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />
          {t("live.fans", { n: fans.toLocaleString() })}
        </span>
      </div>

      {/* Scoreline */}
      <div className="flex items-center justify-between rounded-md border border-line bg-ink-800/70 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 font-display text-lg font-bold uppercase">
          <TeamDot color={matchInfo.home.primary_color} />
          {matchInfo.home.short_name}
        </span>
        <span className="flex flex-col items-center">
          <span className="font-display text-2xl font-extrabold leading-none tabular-nums text-fg" aria-live="polite">
            {live.score.home} – {live.score.away}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-signal-green">{clockLabel(clockSeconds)}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-display text-lg font-bold uppercase">
          {matchInfo.away.short_name}
          <TeamDot color={matchInfo.away.primary_color} />
        </span>
      </div>

      {/* Ticker */}
      <div>
        <Kicker className="text-[10px]">{t("live.ticker")}</Kicker>
        {live.recentEvents.length === 0 ? (
          <p className="mt-1 text-[12px] text-fg-subtle">{t("live.connecting")}</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {live.recentEvents.slice(0, 5).map((e) => (
              <TickerRow key={e.index} event={e} matchInfo={matchInfo} language={language} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-snug text-fg-muted">{t("live.waitingMoment")}</p>
      <button
        type="button"
        onClick={onPractice}
        className="self-start text-[11px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
      >
        {t("live.practice")}
      </button>
    </div>
  );
};

const TickerRow: React.FC<{ event: LiveEventSummary; matchInfo: MatchInfo; language: "en" | "es" }> = ({
  event,
  matchInfo,
  language,
}) => {
  const { t } = useI18n();
  const isGoal = event.outcome === "goal";
  const team = matchInfo[event.possession_team];
  return (
    <li
      className={cn(
        "flex items-center gap-2 border-b border-line py-1 text-[12px] last:border-b-0",
        isGoal ? "text-signal-green" : "text-fg-muted"
      )}
    >
      <span className="w-7 shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">{event.minute}&apos;</span>
      <TeamDot color={team.primary_color} />
      <span className="min-w-0 flex-1 truncate">{event.labels[language] ?? event.event_type}</span>
      <span className={cn("shrink-0 font-mono text-[10px] uppercase", isGoal && "font-bold")}>
        {t(`live.outcome.${event.outcome}`)}
      </span>
    </li>
  );
};

// ======================================================================
// REVEAL — the optimum, your score and the explanation
// ======================================================================
export const RevealCard: React.FC<{ reveal: MomentReveal; onContinue: () => void }> = ({ reveal, onContinue }) => {
  const { t } = useI18n();
  const scored = reveal.your_score != null;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <Kicker className="text-signal-green">{t("reveal.kicker")}</Kicker>
        <Tag tone={reveal.mode === "attack" ? "green" : undefined}>{t(`challenge.mode.${reveal.mode}`)}</Tag>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col justify-between rounded-md border border-line bg-ink-800/70 p-2">
          <Kicker className="text-[10px]">{t("reveal.yourScore")}</Kicker>
          <span className={cn("font-display text-3xl font-extrabold leading-none tabular-nums", scored ? "text-fg" : "text-fg-subtle")}>
            {scored ? reveal.your_score : "—"}
            <span className="ml-1 font-mono text-[10px] font-normal text-fg-subtle">/1000</span>
          </span>
        </div>
        <div className="flex flex-col justify-between rounded-md border border-line bg-ink-800/70 p-2">
          <Kicker className="text-[10px]">{t("reveal.goalChance")}</Kicker>
          <dl className="mt-1 grid grid-cols-3 gap-1 text-center">
            <ChanceStat label={t("reveal.before")} value={reveal.goal_chance_pct.before} />
            <ChanceStat label={t("reveal.yours")} value={reveal.goal_chance_pct.yours} />
            <ChanceStat label={t("reveal.best")} value={reveal.goal_chance_pct.best} accent />
          </dl>
        </div>
      </div>

      {reveal.beat_machine && (
        <div className="flex items-center gap-2 rounded-md border border-signal-green/50 bg-signal-green/10 px-2.5 py-1.5 text-[12px] text-fg">
          <Award className="h-4 w-4 text-signal-green" aria-hidden />
          {t("reveal.beat")}
        </div>
      )}

      <div className="rounded-md border border-line bg-ink-800/40 p-2.5">
        <h3 className="font-display text-lg font-bold leading-tight text-fg">{reveal.explanation.headline}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{reveal.explanation.body}</p>
        <p className="mt-2 text-[12.5px] font-medium text-fg">{reveal.explanation.personal}</p>
        <p className="mt-1 text-[11.5px] text-fg-subtle">{reveal.explanation.community}</p>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="h-2 w-2 rounded-full border border-signal-green bg-signal-green/30" aria-hidden />
        {t("reveal.legend")}
      </p>

      <Button variant="primary" onClick={onContinue}>
        {t("reveal.continue")}
      </Button>
    </div>
  );
};

const ChanceStat: React.FC<{ label: string; value: number | null; accent?: boolean }> = ({ label, value, accent }) => (
  <div>
    <dt className="font-mono text-[9px] uppercase text-fg-subtle">{label}</dt>
    <dd className={cn("font-display text-base font-bold tabular-nums", accent ? "text-signal-green" : "text-fg")}>
      {value == null ? "—" : `${value}%`}
    </dd>
  </div>
);

// ======================================================================
// LEADERBOARD
// ======================================================================
export const LeaderboardCard: React.FC<{
  leaderboard: Leaderboard | null;
  matchInfo: MatchInfo;
  nickname: string;
  rows?: number;
}> = ({ leaderboard, matchInfo, nickname, rows = 5 }) => {
  const { t } = useI18n();
  const top = leaderboard?.top.slice(0, rows) ?? [];
  const scored = top.some((r) => r.total > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Kicker className="flex items-center gap-1.5">
          <Trophy className="h-3 w-3" aria-hidden />
          {t("board.kicker")}
        </Kicker>
        {leaderboard?.you && (
          <span className="font-mono text-[10px] text-fg-muted">
            {t("board.you")} #{leaderboard.you.rank} · {leaderboard.you.total}
          </span>
        )}
      </div>
      {!scored ? (
        <p className="text-[12px] text-fg-subtle">{t("board.empty")}</p>
      ) : (
        <ol className="flex flex-col rounded-md border border-line">
          {top.map((r) => {
            const isYou = r.nickname === nickname && !r.is_bot;
            return (
              <li
                key={`${r.rank}-${r.nickname}`}
                className={cn(
                  "flex items-center gap-2 border-b border-line px-2 py-1 text-[12px] last:border-b-0",
                  isYou ? "bg-signal-green/10 text-fg" : "text-fg-muted"
                )}
              >
                <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">{r.rank}</span>
                <TeamDot color={matchInfo[r.team].primary_color} />
                <span className="min-w-0 flex-1 truncate">{r.nickname}</span>
                <span className="font-mono text-[11px] tabular-nums text-fg">{r.total}</span>
              </li>
            );
          })}
        </ol>
      )}
      {leaderboard && (
        <div className="grid grid-cols-2 gap-1.5">
          {(["home", "away"] as TeamSide[]).map((side) => (
            <div key={side} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-fg-muted">
              <TeamDot color={matchInfo[side].primary_color} />
              <span className="truncate">
                {t("board.teamAvg", { team: matchInfo[side].short_name, avg: leaderboard.teams[side].avg })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ======================================================================
// FULL TIME
// ======================================================================
export const MatchEndCard: React.FC<{ end: MatchEnd; matchInfo: MatchInfo }> = ({ end, matchInfo }) => {
  const { t } = useI18n();
  const [left, setLeft] = useState(end.next_kickoff_in_s);
  useEffect(() => {
    setLeft(end.next_kickoff_in_s);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [end]);
  const you = end.leaderboard.you;
  return (
    <div className="flex flex-col gap-2.5">
      <Kicker className="text-signal-green">{t("end.kicker")}</Kicker>
      <div className="flex items-center justify-center gap-3 rounded-md border border-line bg-ink-800/70 py-2 font-display text-2xl font-extrabold uppercase">
        <span>{matchInfo.home.short_name}</span>
        <span className="tabular-nums">{end.score.home} – {end.score.away}</span>
        <span>{matchInfo.away.short_name}</span>
      </div>
      {you && <p className="text-[13px] text-fg">{t("end.rank", { rank: you.rank, n: end.leaderboard.players, pts: you.total })}</p>}
      {end.badges.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {end.badges.map((b) => (
            <li key={b} className="inline-flex items-center gap-1 rounded-md border border-signal-green/50 bg-signal-green/10 px-2 py-1 text-[12px] text-fg">
              <Award className="h-3.5 w-3.5 text-signal-green" aria-hidden />
              {t(BADGE_KEYS[b] ?? "badge.player_of_the_match")}
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-[11px] text-fg-subtle">{t("end.next", { s: left })}</p>
    </div>
  );
};
