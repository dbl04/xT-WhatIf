"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CloudOff,
  Lock,
  Play,
  RotateCcw,
  Shield,
  Swords,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button, IconButton, Kicker, Tag } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CHALLENGE_DURATION_S,
  CHALLENGE_URGENT_S,
  ChallengeMode,
  ChallengeTrend,
  DEFAULT_RULES,
} from "@/lib/challenge";
import { PALETTE } from "@/lib/palette";
import type { ChallengeState } from "@/hooks/useChallenge";
import type { PlayerNode, TeamInfo } from "@/types/match";

const MODE_ICON: Record<ChallengeMode, React.ElementType> = { attack: Swords, defend: Shield };

const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Mode headline shared by every challenge card. */
const ModeHeadline: React.FC<{ mode: ChallengeMode; teamColor?: string }> = ({ mode, teamColor }) => {
  const { t } = useI18n();
  const Icon = MODE_ICON[mode];
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
          mode === "attack" ? "border-signal-gain/40 text-signal-gain" : "border-team-home/50 text-team-home"
        )}
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-display text-2xl font-bold uppercase leading-none tracking-tight text-fg">
          {teamColor && (
            <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ backgroundColor: teamColor }} aria-hidden />
          )}
          {t(`challenge.mode.${mode}`)}
        </div>
        <div className="mt-0.5 text-[12px] text-fg-muted">{t(`challenge.goal.${mode}`)}</div>
      </div>
    </div>
  );
};

// ======================================================================
// ENTRY CARD — "Play this moment" (temporary trigger until MOMENT_OPEN exists)
// ======================================================================
export const PlayMomentCard: React.FC<{
  mode: ChallengeMode;
  possessionTeam: TeamInfo;
  supportedTeam: TeamInfo;
  onPlay: () => void;
}> = ({ mode, possessionTeam, supportedTeam, onPlay }) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={t("challenge.playAria", {
        mode: t(`challenge.mode.${mode}`),
        s: CHALLENGE_DURATION_S,
        n: DEFAULT_RULES.max_players,
      })}
      className={cn(
        "group relative flex w-full flex-col gap-3 overflow-hidden rounded-lg border border-line-strong bg-ink-800/60 p-3 pt-4 text-left transition-colors",
        "hover:border-signal-gain/60 hover:bg-ink-800",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-gain"
      )}
    >
      {/* Kit colour stripe of the user's team, like the onboarding cards */}
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: supportedTeam.primary_color }} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <Kicker className="text-signal-gain">{t("challenge.kicker")}</Kicker>
        <Tag>{t("challenge.possession", { team: possessionTeam.short_name })}</Tag>
      </div>
      <ModeHeadline mode={mode} />
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
          {t("challenge.playMeta", {
            s: CHALLENGE_DURATION_S,
            n: DEFAULT_RULES.max_players,
            r: DEFAULT_RULES.max_radius_m,
          })}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-fg px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors group-hover:bg-white">
          <Play className="h-3 w-3 fill-current" aria-hidden />
          {t("challenge.play")}
        </span>
      </div>
    </button>
  );
};

// ======================================================================
// STAT TILES
// ======================================================================
const Tile: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className,
  children,
}) => (
  <div className={cn("flex min-w-0 flex-col justify-between rounded-md border border-line bg-ink-800/70 p-2", className)}>
    <Kicker className="text-[10px]">{label}</Kicker>
    {children}
  </div>
);

const TREND_ICON: Record<ChallengeTrend, React.ElementType> = {
  better: ArrowUp,
  worse: ArrowDown,
  same: ArrowRight,
};

const TREND_TONE: Record<ChallengeTrend, string> = {
  better: "text-signal-gain",
  worse: "text-signal-loss",
  same: "text-fg-muted",
};

/** The only feedback on the value: up = better for your side, down = worse, flat = same. */
const TrendArrow: React.FC<{ trend: ChallengeTrend; checking: boolean; className?: string }> = ({
  trend,
  checking,
  className,
}) => {
  const Icon = TREND_ICON[trend];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={trend}
        initial={{ opacity: 0, y: trend === "better" ? 6 : trend === "worse" ? -6 : 0 }}
        animate={{ opacity: checking ? 0.45 : 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className={cn("flex", TREND_TONE[trend])}
        data-trend={trend}
      >
        <Icon className={className} strokeWidth={2.5} aria-hidden />
      </motion.span>
    </AnimatePresence>
  );
};

const TrendTile: React.FC<{ trend: ChallengeTrend; checking: boolean; offline: boolean }> = ({
  trend,
  checking,
  offline,
}) => {
  const { t } = useI18n();
  return (
    <Tile label={t("challenge.trend")}>
      <div
        className="mt-1 flex h-7 items-center gap-1"
        role="status"
        aria-label={offline ? t("challenge.offline") : t(`challenge.trendAria.${trend}`)}
      >
        <TrendArrow trend={trend} checking={checking} className="h-7 w-7" />
        {offline && <CloudOff className="ml-auto h-3 w-3 text-fg-subtle" aria-hidden />}
      </div>
      <span className={cn("mt-0.5 truncate text-[10px] font-medium leading-tight", TREND_TONE[trend])}>
        {checking ? t("challenge.checking") : t(`challenge.trend.${trend}`)}
      </span>
    </Tile>
  );
};

const TimerTile: React.FC<{ secondsLeft: number; durationS: number; stopped: boolean }> = ({
  secondsLeft,
  durationS,
  stopped,
}) => {
  const { t } = useI18n();
  const urgent = !stopped && secondsLeft <= CHALLENGE_URGENT_S;
  const pct = Math.max(0, Math.min(100, (secondsLeft / Math.max(1, durationS)) * 100));
  return (
    <Tile label={t("challenge.time")}>
      <span
        role="timer"
        aria-label={t("challenge.timeAria", { s: secondsLeft })}
        className={cn(
          "mt-1 font-display text-[28px] font-bold leading-none tabular-nums",
          urgent ? "text-signal-loss" : "text-fg",
          urgent && secondsLeft > 0 && "motion-safe:animate-pulse"
        )}
      >
        {formatClock(secondsLeft)}
      </span>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
        <span
          className={cn("block h-full rounded-full transition-[width] duration-300 ease-linear", urgent ? "bg-signal-loss" : "bg-signal-gain")}
          style={{ width: `${pct}%` }}
        />
      </span>
    </Tile>
  );
};

const MovesTile: React.FC<{ used: number; max: number }> = ({ used, max }) => {
  const { t } = useI18n();
  return (
    <Tile label={t("challenge.moves")}>
      <span className="mt-1 font-display text-[28px] font-bold leading-none tabular-nums text-fg">
        {used}
        <span className="text-fg-subtle">/{max}</span>
      </span>
      <span className="mt-1.5 flex gap-1" aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", i < used ? "bg-fg" : "bg-white/[0.08]")} />
        ))}
      </span>
    </Tile>
  );
};

/** Polite announcements: 10 s left and time up (the timer itself is not read every second). */
function useTimerAnnouncement(secondsLeft: number, open: boolean, auto: boolean) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const announced10 = useRef(false);
  useEffect(() => {
    if (open && secondsLeft === CHALLENGE_URGENT_S && !announced10.current) {
      announced10.current = true;
      setMessage(t("challenge.tenSeconds"));
    }
    if (!open && auto) setMessage(t("challenge.timeUp"));
  }, [secondsLeft, open, auto, t]);
  return message;
}

// ======================================================================
// CHALLENGE CARD — open and submitted states
// ======================================================================
export const ChallengeCard: React.FC<{
  state: ChallengeState;
  secondsLeft: number;
  notice: "limit" | "locked" | null;
  teamInfo?: TeamInfo;
  onConfirm: () => void;
  onReset: () => void;
  onLeave: () => void;
  onHighlightPlayer?: (playerId: number | null) => void;
}> = ({ state, secondsLeft, notice, teamInfo, onConfirm, onReset, onLeave, onHighlightPlayer }) => {
  const { t, locale } = useI18n();
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const isOpen = state.status === "open";
  const announcement = useTimerAnnouncement(secondsLeft, isOpen, !!state.submission?.auto);
  const byId = new Map<number, PlayerNode>(state.players.map((p) => [p.player_id, p]));
  const moved = state.players.filter((p) => p.is_modified);
  const playerLabel = (id: number) => {
    const p = byId.get(id);
    return p ? `#${p.jersey_number} ${p.name.split(" ").pop()}` : `#${id}`;
  };

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden p-3 pt-4">
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: teamInfo?.primary_color ?? PALETTE.gain }}
        aria-hidden
      />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <div className="flex items-center justify-between gap-2">
        <Kicker className="text-signal-gain">{t("challenge.kicker")}</Kicker>
        {isOpen ? (
          <IconButton size="sm" onClick={onLeave} title={t("challenge.leave")} aria-label={t("challenge.leave")}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        ) : (
          <Tag tone={state.submission?.auto ? "magenta" : "green"}>
            {state.submission?.auto ? <Lock className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
            {state.submission?.auto ? t("challenge.autoSubmitted") : t("challenge.submitted")}
          </Tag>
        )}
      </div>

      <ModeHeadline mode={state.mode} teamColor={teamInfo?.primary_color} />

      {isOpen ? (
        <>
          <p className="-mt-1 text-[12px] leading-snug text-fg-muted">{t(`challenge.task.${state.mode}`)}</p>

          <div className="grid grid-cols-3 gap-1.5">
            <TimerTile secondsLeft={secondsLeft} durationS={state.durationS} stopped={!isOpen} />
            <MovesTile used={moved.length} max={state.rules.max_players} />
            <TrendTile trend={state.trend} checking={state.checking} offline={state.offline} />
          </div>

          <AnimatePresence initial={false}>
            {notice && (
              <motion.p
                key={notice}
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-1.5 overflow-hidden rounded-md border border-signal-loss/40 bg-signal-loss/10 px-2 py-1.5 text-[12px] text-fg"
              >
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-signal-loss" aria-hidden />
                {notice === "limit"
                  ? t("challenge.limit", { n: state.rules.max_players })
                  : t("challenge.locked")}
              </motion.p>
            )}
          </AnimatePresence>

          {state.violations.length > 0 && (
            <div className="rounded-md border border-signal-loss/40 bg-signal-loss/[0.07] p-2" aria-live="polite">
              <Kicker className="text-signal-loss">{t("challenge.violations")}</Kicker>
              <ul className="mt-1 flex flex-col gap-0.5">
                {state.violations.map((v, i) => (
                  <li
                    key={`${v.player_id}-${v.rule}-${i}`}
                    className="flex items-center justify-between gap-2 text-[12px]"
                    onMouseEnter={() => onHighlightPlayer?.(v.player_id)}
                    onMouseLeave={() => onHighlightPlayer?.(null)}
                  >
                    <span className="truncate text-fg">{playerLabel(v.player_id)}</span>
                    <span className="shrink-0 font-medium text-signal-loss">{t(`challenge.rule.${v.rule}`)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-fg-muted">{t("challenge.illegalNote")}</p>
            </div>
          )}

          <div className="flex flex-col gap-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
            <span>
              {t("challenge.rules", {
                n: state.rules.max_players,
                r: num.format(state.rules.max_radius_m),
                d: num.format(state.rules.min_spacing_m),
              })}
            </span>
            {state.rules.offside_line_x != null && (
              <span className="normal-case tracking-normal">{t("challenge.offsideHint")}</span>
            )}
            {state.offline && (
              <span className="flex items-center gap-1 normal-case tracking-normal">
                <CloudOff className="h-3 w-3" aria-hidden />
                {t("challenge.offline")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={onReset} disabled={moved.length === 0}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("challenge.reset")}
            </Button>
            <Button variant="primary" onClick={onConfirm} className="ml-auto h-9 px-5 text-sm">
              <Check className="h-4 w-4" aria-hidden />
              {t("challenge.confirm")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-md border border-line bg-ink-800/70 p-2.5">
            <div className="font-display text-lg font-bold uppercase leading-none tracking-tight text-fg">
              {t("challenge.submittedTitle")}
            </div>
            {state.submission && state.submission.moves.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {state.submission.moves.map((m) => {
                  const p = byId.get(m.player_id);
                  const ox = p?.original_x ?? m.x;
                  const oy = p?.original_y ?? m.y;
                  const dist = Math.hypot(m.x - ox, m.y - oy);
                  return (
                    <li key={m.player_id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ArrowUp
                          className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                          style={{ transform: `rotate(${(Math.atan2(m.y - oy, m.x - ox) * 180) / Math.PI + 90}deg)` }}
                          aria-hidden
                        />
                        <span className="truncate text-fg">{playerLabel(m.player_id)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                        {num.format(Number(dist.toFixed(1)))} m
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-fg-muted">{t("challenge.noMoves")}</p>
            )}
          </div>

          {state.violations.length > 0 && (
            <ul className="flex flex-col gap-0.5 rounded-md border border-signal-loss/40 bg-signal-loss/[0.07] p-2 text-[12px]">
              {state.violations.map((v, i) => (
                <li key={`${v.player_id}-${v.rule}-${i}`} className="flex justify-between gap-2">
                  <span className="truncate text-fg">{playerLabel(v.player_id)}</span>
                  <span className="shrink-0 text-signal-loss">{t(`challenge.rule.${v.rule}`)}</span>
                </li>
              ))}
              <li className="mt-1 text-[11px] text-fg-muted">{t("challenge.illegalDropped")}</li>
            </ul>
          )}

          <p className="text-[12px] text-fg-muted">{t("challenge.revealSoon")}</p>

          <div className="flex items-center border-t border-line pt-3">
            <Button variant="secondary" onClick={onLeave} className="ml-auto">
              {t("challenge.back")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

// ======================================================================
// CHALLENGE STRIP — compact card for phones and short screens (< lg), in place of the
// transport dock so the pitch stays visible.
// ======================================================================
export const ChallengeStrip: React.FC<{
  state: ChallengeState;
  secondsLeft: number;
  notice: "limit" | "locked" | null;
  teamInfo?: TeamInfo;
  onConfirm: () => void;
  onReset: () => void;
  onLeave: () => void;
}> = ({ state, secondsLeft, notice, teamInfo, onConfirm, onReset, onLeave }) => {
  const { t } = useI18n();
  const isOpen = state.status === "open";
  const announcement = useTimerAnnouncement(secondsLeft, isOpen, !!state.submission?.auto);
  const used = state.players.filter((p) => p.is_modified).length;
  const urgent = isOpen && secondsLeft <= CHALLENGE_URGENT_S;
  const pct = Math.max(0, Math.min(100, (secondsLeft / Math.max(1, state.durationS)) * 100));
  const Icon = MODE_ICON[state.mode];
  const byId = new Map(state.players.map((p) => [p.player_id, p]));
  const firstViolation = state.violations[0];

  let message: React.ReactNode = null;
  if (!isOpen) {
    message = t("challenge.revealSoon");
  } else if (notice) {
    message = (
      <span className="text-fg">
        {notice === "limit" ? t("challenge.limit", { n: state.rules.max_players }) : t("challenge.locked")}
      </span>
    );
  } else if (firstViolation) {
    const p = byId.get(firstViolation.player_id);
    message = (
      <span className="text-signal-loss">
        {p ? `#${p.jersey_number} ${p.name.split(" ").pop()} · ` : ""}
        {t(`challenge.rule.${firstViolation.rule}`)}
        {state.violations.length > 1 ? ` (+${state.violations.length - 1})` : ""}
      </span>
    );
  } else if (state.offline) {
    message = t("challenge.offline");
  } else {
    message = (
      <>
        <span className="font-semibold uppercase text-fg min-[420px]:hidden">{t(`challenge.mode.${state.mode}`)} · </span>
        {t(`challenge.goal.${state.mode}`)}
      </>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line-strong bg-ink-900/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      aria-label={t("challenge.kicker")}
      role="region"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: teamInfo?.primary_color ?? PALETTE.gain }} aria-hidden />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2.5 sm:gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={cn("h-4 w-4 shrink-0", state.mode === "attack" ? "text-signal-gain" : "text-team-home")}
            aria-hidden
          />
          <span className="hidden truncate font-display text-lg font-bold uppercase leading-none tracking-tight text-fg min-[420px]:inline">
            {t(`challenge.mode.${state.mode}`)}
          </span>
        </span>

        <span
          role="timer"
          aria-label={t("challenge.timeAria", { s: secondsLeft })}
          className={cn(
            "font-display text-2xl font-bold leading-none tabular-nums",
            urgent ? "text-signal-loss" : "text-fg",
            urgent && secondsLeft > 0 && "motion-safe:animate-pulse"
          )}
        >
          {formatClock(secondsLeft)}
        </span>

        <span
          className="font-display text-lg font-bold leading-none tabular-nums text-fg"
          aria-label={`${t("challenge.moves")}: ${used}/${state.rules.max_players}`}
        >
          {used}
          <span className="text-fg-subtle">/{state.rules.max_players}</span>
        </span>

        <span
          role="status"
          aria-label={state.offline ? t("challenge.offline") : t(`challenge.trendAria.${state.trend}`)}
          className="flex items-center"
        >
          <TrendArrow trend={state.trend} checking={state.checking} className="h-6 w-6" />
        </span>

        <span className="ml-auto flex items-center gap-1">
          {isOpen ? (
            <>
              <IconButton
                onClick={onReset}
                disabled={used === 0}
                title={t("challenge.reset")}
                aria-label={t("challenge.reset")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </IconButton>
              <Button variant="primary" onClick={onConfirm} className="px-3.5">
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t("challenge.confirm")}
              </Button>
            </>
          ) : (
            <>
              <Tag tone={state.submission?.auto ? "magenta" : "green"} className="hidden sm:inline-flex">
                {state.submission?.auto ? t("challenge.autoSubmitted") : t("challenge.submitted")}
              </Tag>
              <Button variant="secondary" onClick={onLeave}>
                {t("challenge.back")}
              </Button>
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 px-2.5 pb-2 text-[11px] text-fg-muted">
        {!isOpen && (
          <Tag tone={state.submission?.auto ? "magenta" : "green"} className="sm:hidden">
            {state.submission?.auto ? t("challenge.autoSubmitted") : t("challenge.submitted")}
          </Tag>
        )}
        <span className="min-w-0 truncate" aria-live="polite">
          {message}
        </span>
        {isOpen && (
          <button
            type="button"
            onClick={onLeave}
            className="ml-auto shrink-0 text-[11px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
          >
            {t("challenge.leave")}
          </button>
        )}
      </div>
      <span className="block h-0.5 bg-white/[0.06]" aria-hidden>
        <span
          className={cn(
            "block h-full transition-[width] duration-300 ease-linear",
            !isOpen ? "bg-fg-subtle" : urgent ? "bg-signal-loss" : "bg-signal-gain"
          )}
          style={{ width: `${isOpen ? pct : 100}%` }}
        />
      </span>
    </div>
  );
};
