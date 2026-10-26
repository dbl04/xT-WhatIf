"use client";

import React, { useEffect, useRef, useState } from "react";
import { Award, Download, Dumbbell, Play, RotateCcw, Square, Trophy, Users } from "lucide-react";
import { Button, Kicker, Tag } from "@/components/ui/primitives";
import { MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MatchInfo, TeamSide } from "@/types/match";
import type { Leaderboard, LiveEventSummary, LiveState, MatchEnd, MomentReveal } from "@/hooks/useLiveMatch";
import type { ReplayView } from "@/hooks/useRevealReplay";

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
        <Kicker className="text-signal-gain">{t("live.kicker")}</Kicker>
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
          <span className="font-mono text-[10px] tabular-nums text-signal-gain">{clockLabel(clockSeconds)}</span>
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
      <Button variant="secondary" onClick={onPractice} className="w-full">
        <Dumbbell className="h-3.5 w-3.5" aria-hidden />
        {t("live.practice")}
      </Button>
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
        isGoal ? "text-signal-gain" : "text-fg-muted"
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
// REVEAL — the optimum, your score and the dialectical pundit commentary
// ======================================================================
export const RevealCard: React.FC<{
  reveal: MomentReveal;
  onContinue: () => void;
  /** Replay on the pitch: which shape is shown, and the controls to switch or replay it. */
  view?: ReplayView;
  onView?: (view: ReplayView) => void;
  onReplay?: () => void;
  activeSpeaker?: "data_scientist" | "classic_coach" | null;
  isSpeaking?: boolean;
  onPlayVoice?: () => void;
  onStopVoice?: () => void;
}> = ({
  reveal,
  onContinue,
  view,
  onView,
  onReplay,
  activeSpeaker = null,
  isSpeaking = false,
  onPlayVoice,
  onStopVoice,
}) => {
  const { t, language } = useI18n();
  const scored = reveal.your_score != null;
  const voronoiPundit = reveal.pundits?.find((p) => p.agent_role === "data_scientist");
  const bianchiPundit = reveal.pundits?.find((p) => p.agent_role === "classic_coach");
  const voronoiSpeaking = isSpeaking && activeSpeaker === "data_scientist";
  const bianchiSpeaking = isSpeaking && activeSpeaker === "classic_coach";
  const bianchiName = language === "es" ? "Míster Bianchi" : "Coach Bianchi";
  const bianchiHeadline = reveal.explanation.bianchi_headline ?? bianchiPundit?.headline;

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <Kicker className="text-signal-gain">{t("reveal.kicker")}</Kicker>
        <div className="flex items-center gap-1.5">
          {(onPlayVoice || onStopVoice) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (isSpeaking ? onStopVoice?.() : onPlayVoice?.())}
            >
              {isSpeaking ? (
                <>
                  <Square className="h-3 w-3 fill-current" aria-hidden /> {t("card.stop")}
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 fill-current" aria-hidden /> {t("card.listen")}
                </>
              )}
            </Button>
          )}
          <Tag tone={reveal.mode === "attack" ? "green" : undefined}>{t(`challenge.mode.${reveal.mode}`)}</Tag>
        </div>
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

      {view && onView && (
        <div className="flex items-center gap-1.5">
          <div className="flex h-8 flex-1 items-center rounded-md border border-line bg-ink-800 p-0.5" role="group" aria-label={t("reveal.replay")}>
            {(["yours", "best"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onView(v)}
                aria-pressed={view === v}
                className={cn(
                  "h-full flex-1 rounded-[4px] px-2 text-[12px] font-medium transition-colors",
                  view === v ? (v === "best" ? "bg-signal-gain/20 text-signal-gain" : "bg-white/[0.1] text-fg") : "text-fg-subtle hover:text-fg"
                )}
              >
                {t(v === "best" ? "reveal.view.best" : "reveal.view.yours")}
              </button>
            ))}
          </div>
          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              title={t("reveal.replayAgain")}
              aria-label={t("reveal.replayAgain")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-ink-800 text-fg-subtle transition-colors hover:border-line-strong hover:text-fg"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      {reveal.beat_machine && (
        <div className="flex items-center gap-2 rounded-md border border-signal-gain/50 bg-signal-gain/10 px-2.5 py-1.5 text-[12px] text-fg">
          <Award className="h-4 w-4 text-signal-gain" aria-hidden />
          {t("reveal.beat")}
        </div>
      )}

      {/* Dr. Voronoi (AI-QUANT): Spatial & Quantitative Bot vs User Comparison */}
      <div
        className={cn(
          "rounded-md border p-2.5 transition-colors",
          voronoiSpeaking
            ? "border-signal-gain bg-signal-gain/[0.08]"
            : "border-line bg-ink-800/40"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-4 items-center rounded-[2px] bg-fg px-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-ink">
              AI-QUANT
            </span>
            <span className="font-display text-xs font-extrabold uppercase tracking-wide text-fg">
              Dr. Voronoi
            </span>
            <span className="text-[10px] text-fg-subtle">· {t("role.data_scientist")}</span>
          </div>
          {voronoiSpeaking && (
            <span className="inline-flex items-center gap-1 rounded-[2px] bg-signal-gain/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-signal-gain">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-gain" />
              {t("card.onAir")}
            </span>
          )}
        </div>
        <h3 className="mt-1.5 font-display text-[15px] font-bold leading-tight text-fg">
          {reveal.explanation.headline}
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
          {reveal.explanation.body}
        </p>
        {reveal.explanation.voronoi_comparison && (
          <p className="mt-1.5 border-l-2 border-signal-gain/60 pl-2 text-[11.5px] leading-relaxed text-fg">
            {reveal.explanation.voronoi_comparison}
          </p>
        )}
        {voronoiPundit?.referenced_metric && (
          <div className="mt-2">
            <Tag tone="green">{voronoiPundit.referenced_metric}</Tag>
          </div>
        )}
      </div>

      {/* Coach Bianchi (PRO-COACH): Dressing-Room Verdict & User vs Bot Tactical Contrast */}
      <div
        className={cn(
          "rounded-md border p-2.5 transition-colors",
          bianchiSpeaking
            ? "border-signal-gain bg-signal-gain/[0.08]"
            : "border-line bg-ink-800/40"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-4 items-center rounded-[2px] bg-ink-700 px-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-fg">
              PRO-COACH
            </span>
            <span className="font-display text-xs font-extrabold uppercase tracking-wide text-fg">
              {bianchiName}
            </span>
            <span className="text-[10px] text-fg-subtle">· {t("role.classic_coach")}</span>
          </div>
          {bianchiSpeaking && (
            <span className="inline-flex items-center gap-1 rounded-[2px] bg-signal-gain/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-signal-gain">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-gain" />
              {t("card.onAir")}
            </span>
          )}
        </div>
        {bianchiHeadline && (
          <h4 className="mt-1.5 font-display text-[15px] font-bold leading-tight text-fg">
            {bianchiHeadline}
          </h4>
        )}
        <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
          {reveal.explanation.personal}
        </p>
        {bianchiPundit?.referenced_metric && (
          <div className="mt-2">
            <Tag>{bianchiPundit.referenced_metric}</Tag>
          </div>
        )}
      </div>

      <p className="text-[11.5px] text-fg-subtle">{reveal.explanation.community}</p>

      <Button variant="primary" onClick={onContinue}>
        {t("reveal.continue")}
      </Button>
    </div>
  );
};

const ChanceStat: React.FC<{ label: string; value: number | null; accent?: boolean }> = ({ label, value, accent }) => (
  <div>
    <dt className="font-mono text-[9px] uppercase text-fg-subtle">{label}</dt>
    <dd className={cn("font-display text-base font-bold tabular-nums", accent ? "text-signal-gain" : "text-fg")}>
      {value == null ? "—" : `${value}%`}
    </dd>
  </div>
);

// ======================================================================
// LEADERBOARD — the top rows and, below them, the fan's own position when outside them
// ======================================================================
export const LeaderboardCard: React.FC<{
  leaderboard: Leaderboard | null;
  matchInfo: MatchInfo;
  nickname: string;
  team: TeamSide;
  rows?: number;
  /**
   * Fill the parent's height with as many top rows as fit, keeping room for the fan's own row:
   * "always" (its own column), or "stacked" (only from sm to lg, next to the match events).
   * The list is absolutely positioned while filling, so it takes the height it is given and
   * never pushes its parent taller.
   */
  fill?: "always" | "stacked";
}> = ({ leaderboard, matchInfo, nickname, team, rows = 5, fill }) => {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [fitRows, setFitRows] = useState(rows);
  useEffect(() => {
    const el = listRef.current;
    const inner = innerRef.current;
    if (!fill || !el || !inner || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (getComputedStyle(inner).position !== "absolute") {
        setFitRows(rows);
        return;
      }
      const rowPx = inner.querySelector("li")?.getBoundingClientRect().height || 25;
      // List border, the "…" separator (16 px) and the fan's own row stay visible.
      setFitRows(Math.max(3, Math.floor((el.clientHeight - 2 - 16 - rowPx) / rowPx)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill, rows]);
  const top = leaderboard?.top.slice(0, fill ? fitRows : rows) ?? [];
  const you = leaderboard?.you ?? null;
  // Ranks are unique, so the fan's row is found by rank (nicknames may repeat).
  const youInTop = !!you && top.some((r) => r.rank === you.rank);
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        fill === "always" && "h-full min-h-0",
        fill === "stacked" && "sm:h-full sm:min-h-0 lg:h-auto"
      )}
    >
      <Kicker className="flex items-center gap-1.5">
        <Trophy className="h-3 w-3" aria-hidden />
        {t("board.kicker")}
      </Kicker>
      <div
        ref={listRef}
        className={cn(
          fill === "always" && "relative min-h-0 flex-1",
          fill === "stacked" && "sm:relative sm:min-h-0 sm:flex-1 lg:static lg:flex-none"
        )}
      >
      <div
        ref={innerRef}
        className={cn(
          fill === "always" && "absolute inset-0 overflow-hidden",
          fill === "stacked" && "sm:absolute sm:inset-0 sm:overflow-hidden lg:static lg:overflow-visible"
        )}
      >
      {top.length > 0 && (
        <ol className="flex flex-col rounded-md border border-line">
          {top.map((r) => (
            <LeaderboardRow
              key={`${r.rank}-${r.nickname}`}
              rank={r.rank}
              nickname={r.nickname}
              total={r.total}
              color={matchInfo[r.team].primary_color}
              isYou={!!you && r.rank === you.rank}
            />
          ))}
          {you && !youInTop && (
            <>
              <li aria-hidden className="border-b border-line px-2 text-center font-mono text-[10px] leading-4 text-fg-subtle">
                …
              </li>
              <LeaderboardRow
                rank={you.rank}
                nickname={nickname}
                total={you.total}
                color={matchInfo[team].primary_color}
                isYou
              />
            </>
          )}
        </ol>
      )}
      </div>
      </div>
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

export const LeaderboardRow: React.FC<{ rank: number; nickname: string; total: number; color?: string; isYou: boolean }> = ({
  rank,
  nickname,
  total,
  color,
  isYou,
}) => (
  <li
    aria-current={isYou ? "true" : undefined}
    className={cn(
      "flex items-center gap-2 border-b border-line px-2 py-1 text-[12px] last:border-b-0",
      isYou ? "bg-signal-gain/10 font-semibold text-fg" : "text-fg-muted"
    )}
  >
    <span className="w-6 shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">{rank}</span>
    <TeamDot color={color} />
    <span className="min-w-0 flex-1 truncate">{nickname}</span>
    <span className="font-mono text-[11px] tabular-nums text-fg">{total}</span>
  </li>
);

// ======================================================================
// FULL TIME
// ======================================================================
export const MatchEndCard: React.FC<{ end: MatchEnd; matchInfo: MatchInfo; onExport?: () => void }> = ({
  end,
  matchInfo,
  onExport,
}) => {
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
      <Kicker className="text-signal-gain">{t("end.kicker")}</Kicker>
      <div className="flex items-center justify-center gap-3 rounded-md border border-line bg-ink-800/70 py-2 font-display text-2xl font-extrabold uppercase">
        <span>{matchInfo.home.short_name}</span>
        <span className="tabular-nums">{end.score.home} – {end.score.away}</span>
        <span>{matchInfo.away.short_name}</span>
      </div>
      {you && <p className="text-[13px] text-fg">{t("end.rank", { rank: you.rank, n: end.leaderboard.players, pts: you.total })}</p>}
      {end.badges.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {end.badges.map((b) => (
            <li key={b} className="inline-flex items-center gap-1 rounded-md border border-signal-gain/50 bg-signal-gain/10 px-2 py-1 text-[12px] text-fg">
              <Award className="h-3.5 w-3.5 text-signal-gain" aria-hidden />
              {t(BADGE_KEYS[b] ?? "badge.player_of_the_match")}
            </li>
          ))}
        </ul>
      )}
      {onExport && (
        <Button variant="primary" onClick={onExport} className="w-full">
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t("end.export")}
        </Button>
      )}
      <p className="font-mono text-[11px] text-fg-subtle">{t("end.next", { s: left })}</p>
    </div>
  );
};
