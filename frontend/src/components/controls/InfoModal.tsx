"use client";

import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, FileImage } from "lucide-react";
import { Button, ModalShell } from "@/components/ui/primitives";
import { TeamCrest } from "@/components/onboarding/TeamCrest";
import { LeaderboardRow } from "@/components/live/LiveCards";
import { AUDIENCES, MessageKey, useI18n } from "@/lib/i18n";
import { PALETTE, withAlpha } from "@/lib/palette";
import { cn } from "@/lib/utils";

const INFO_SEEN_KEY = "xt-whatif:info-seen";

/** True on the browser's first visit, until the info pop-up has been closed once. */
export function useFirstVisitInfo(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(INFO_SEEN_KEY) !== "1") setOpen(true);
    } catch {
      // Storage blocked: skip the first-visit pop-up rather than show it on every load.
    }
  }, []);
  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(INFO_SEEN_KEY, "1");
    } catch {
      // Nothing to remember without storage.
    }
  };
  return [open, close];
}

// ======================================================================
// VISUALS — one per card, all in the same frame so the cards line up
// ======================================================================

const TeamVisual: React.FC = () => (
  <div className="flex items-center gap-6">
    <div className="flex flex-col items-center gap-1.5">
      <div className="rounded-lg p-1 ring-2 ring-signal-gain">
        <TeamCrest color={PALETTE.home} shortName="RDM" className="h-16 w-14" />
      </div>
      <span className="font-display text-sm font-bold uppercase text-fg">Redmoor Albion</span>
    </div>
    <span className="font-display text-lg font-bold uppercase text-fg-subtle">v</span>
    <div className="flex flex-col items-center gap-1.5 opacity-50">
      <div className="rounded-lg p-1 ring-1 ring-line-strong">
        <TeamCrest color={PALETTE.away} shortName="SMR" className="h-16 w-14" />
      </div>
      <span className="font-display text-sm font-bold uppercase text-fg">Saltmarsh Rovers</span>
    </div>
  </div>
);

const ProfileVisual: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <div className="flex rounded-md border border-line-strong p-0.5 font-mono text-[12px]">
        <span className="rounded bg-ink-700 px-3 py-1 text-fg">EN</span>
        <span className="px-3 py-1 text-fg-subtle">ES</span>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {AUDIENCES.map((a) => (
          <span
            key={a}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px]",
              a === "analyst" ? "border-signal-gain/60 bg-signal-gain/10 text-fg" : "border-line text-fg-muted"
            )}
          >
            {t(`audience.${a}` as MessageKey)}
          </span>
        ))}
      </div>
    </div>
  );
};

/** A 3-second loop: the fan moves a teammate, then the best move appears in green. */
const MoveDemo: React.FC = () => {
  const reduce = useReducedMotion();
  const loop = { duration: 3, repeat: Infinity, ease: "easeInOut" as const };
  // The fan's move (white) happens first, the best move (green) after it.
  const fanTimes = [0, 0.1, 0.35, 0.9, 1];
  const bestTimes = [0, 0.45, 0.65, 0.9, 1];
  const carrier = { x: 40, y: 52 };
  const teammate = { x: 78, y: 62 };
  const fanEnd = { x: 88, y: 66 };
  const best = { x: 70, y: 22 };
  const bestEnd = { x: 84, y: 18 };
  const ink = PALETTE.ink;

  return (
    <svg viewBox="0 0 160 90" className="h-full w-full" aria-hidden focusable="false">
      <rect x="0" y="0" width="160" height="90" rx="3" fill={PALETTE.turf} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 40} y="0" width="20" height="90" fill={PALETTE.turfStripe} />
      ))}
      <g fill="none" stroke={PALETTE.pitchLine} strokeWidth="0.6">
        <rect x="4" y="4" width="152" height="82" />
        <rect x="128" y="24" width="28" height="42" />
        <rect x="146" y="35" width="10" height="20" />
        <line x1="4" y1="4" x2="4" y2="86" />
      </g>

      {/* Countdown */}
      <rect x="8" y="7" width="40" height="2" rx="1" fill={withAlpha(PALETTE.fg, 0.15)} />
      <motion.rect
        x="8"
        y="7"
        height="2"
        rx="1"
        fill={PALETTE.gain}
        initial={{ width: 40 }}
        animate={reduce ? { width: 12 } : { width: [40, 0] }}
        transition={reduce ? undefined : { duration: 3, repeat: Infinity, ease: "linear" }}
      />

      {/* Defenders */}
      {[
        { x: 66, y: 44 },
        { x: 96, y: 56 },
        { x: 104, y: 32 },
        { x: 120, y: 46 },
      ].map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="3.4" fill={PALETTE.away} opacity="0.85" />
      ))}

      {/* Pass from the ball to the fan's player */}
      <motion.line
        x1={carrier.x}
        y1={carrier.y}
        x2={fanEnd.x}
        y2={fanEnd.y}
        stroke={PALETTE.fg}
        strokeWidth="0.8"
        strokeDasharray="2 2"
        initial={{ opacity: 0 }}
        animate={reduce ? { opacity: 0.6 } : { opacity: [0, 0, 0.7, 0.7, 0] }}
        transition={reduce ? undefined : { ...loop, times: fanTimes }}
      />

      {/* Best pass, in green */}
      <motion.line
        x1={carrier.x}
        y1={carrier.y}
        x2={bestEnd.x}
        y2={bestEnd.y}
        stroke={PALETTE.gain}
        strokeWidth="1.2"
        initial={{ opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0] }}
        transition={reduce ? undefined : { ...loop, times: bestTimes }}
      />

      {/* Ball carrier */}
      <circle cx={carrier.x} cy={carrier.y} r="3.8" fill={PALETTE.home} />
      <circle cx={carrier.x + 4} cy={carrier.y - 3} r="1.5" fill={PALETTE.fg} stroke={ink} strokeWidth="0.4" />

      {/* The teammate the fan drags */}
      <circle cx={teammate.x} cy={teammate.y} r="6" fill="none" stroke={withAlpha(PALETTE.fg, 0.25)} strokeDasharray="1 1.4" strokeWidth="0.5" />
      <motion.g
        initial={{ x: 0, y: 0 }}
        animate={
          reduce
            ? { x: fanEnd.x - teammate.x, y: fanEnd.y - teammate.y }
            : { x: [0, 0, fanEnd.x - teammate.x, fanEnd.x - teammate.x, 0], y: [0, 0, fanEnd.y - teammate.y, fanEnd.y - teammate.y, 0] }
        }
        transition={reduce ? undefined : { ...loop, times: fanTimes }}
      >
        <circle cx={teammate.x} cy={teammate.y} r="3.8" fill={PALETTE.home} stroke={PALETTE.fg} strokeWidth="0.6" />
      </motion.g>

      {/* The best move: another teammate runs into space */}
      <circle cx={best.x} cy={best.y} r="3.8" fill={PALETTE.home} opacity="0.9" />
      <motion.g
        initial={{ x: 0, y: 0, opacity: 0 }}
        animate={
          reduce
            ? { x: bestEnd.x - best.x, y: bestEnd.y - best.y, opacity: 1 }
            : {
                x: [0, 0, bestEnd.x - best.x, bestEnd.x - best.x, 0],
                y: [0, 0, bestEnd.y - best.y, bestEnd.y - best.y, 0],
                opacity: [0, 0, 1, 1, 0],
              }
        }
        transition={reduce ? undefined : { ...loop, times: bestTimes }}
      >
        <circle cx={best.x} cy={best.y} r="4.6" fill="none" stroke={PALETTE.gain} strokeWidth="1" />
        <circle cx={best.x} cy={best.y} r="3.2" fill={PALETTE.gain} />
      </motion.g>
    </svg>
  );
};

const BOARD_EXAMPLE = [
  { rank: 1, nickname: "Overlap 0", total: 2840, home: true },
  { rank: 2, nickname: "Albion Ultra 1", total: 2615, home: true },
  { rank: 3, nickname: "Target Man 2", total: 2470, home: false },
  { rank: 4, nickname: "Overlap 3", total: 2390, home: false },
  { rank: 5, nickname: "Libero 4", total: 2255, home: true },
];

const LeaderboardVisual: React.FC = () => {
  const { t } = useI18n();
  return (
    <ol className="flex w-full max-w-[260px] flex-col rounded-md border border-line bg-ink-900/80">
      {BOARD_EXAMPLE.map((r) => (
        <LeaderboardRow
          key={r.rank}
          rank={r.rank}
          nickname={r.nickname}
          total={r.total}
          color={r.home ? PALETTE.home : PALETTE.away}
          isYou={false}
        />
      ))}
      <li aria-hidden className="border-b border-line px-2 text-center font-mono text-[10px] leading-4 text-fg-subtle">
        …
      </li>
      <LeaderboardRow rank={37} nickname={t("info.you")} total={1180} color={PALETTE.home} isYou />
    </ol>
  );
};

const ExportVisual: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-5">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[13px] font-medium text-ink">
        <Download className="h-4 w-4" aria-hidden />
        {t("nav.export")}
      </span>
      <ChevronRight className="h-5 w-5 text-fg-subtle" aria-hidden />
      <div className="flex w-28 flex-col gap-1.5 rounded-md border border-line-strong bg-ink-900 p-2">
        <div className="h-12 rounded-sm" style={{ backgroundColor: PALETTE.turf }} />
        <div className="h-1.5 w-3/4 rounded-full bg-signal-gain/70" />
        <div className="h-1.5 w-1/2 rounded-full bg-fg/20" />
        <span className="flex items-center gap-1 font-mono text-[9px] uppercase text-fg-subtle">
          <FileImage className="h-3 w-3" aria-hidden />
          PNG
        </span>
      </div>
    </div>
  );
};

const CARDS: { key: string; Visual: React.FC; text: MessageKey }[] = [
  { key: "team", Visual: TeamVisual, text: "info.team" },
  { key: "profile", Visual: ProfileVisual, text: "info.profile" },
  { key: "move", Visual: MoveDemo, text: "info.move" },
  { key: "board", Visual: LeaderboardVisual, text: "info.board" },
  { key: "export", Visual: ExportVisual, text: "info.export" },
];

// ======================================================================
// INFO POP-UP
// ======================================================================
export const InfoModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);
  if (!isOpen) return null;

  const last = index === CARDS.length - 1;
  const card = CARDS[index];
  const Visual = card.Visual;

  return (
    <ModalShell
      kicker={t("info.kicker")}
      title={t("info.title")}
      onClose={onClose}
      className="max-w-lg"
      footer={
        <>
          <div className="flex items-center gap-1.5" role="tablist" aria-label={t("info.title")}>
            {CARDS.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t("info.cardAria", { n: i + 1, total: CARDS.length })}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-signal-gain" : "w-1.5 bg-fg-subtle hover:bg-fg-muted"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" onClick={() => setIndex(index - 1)} aria-label={t("info.back")}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {t("info.back")}
              </Button>
            )}
            <Button variant="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? t("info.start") : t("info.next")}
              {!last && <ChevronRight className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5" role="tabpanel" aria-live="polite">
        <div className="flex h-48 items-center justify-center overflow-hidden rounded-md border border-line bg-ink-800/40 p-3">
          <Visual />
        </div>
        <p className="min-h-[4.5rem] text-[14px] leading-relaxed text-fg">{t(card.text)}</p>
      </div>
    </ModalShell>
  );
};

export default InfoModal;
