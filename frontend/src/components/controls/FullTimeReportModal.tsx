"use client";

import React, { useEffect, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { Button, ModalShell, Tag } from "@/components/ui/primitives";
import { displayFont, monoFont, sansFont } from "@/lib/fonts";
import { PALETTE, withAlpha } from "@/lib/palette";
import { Language, useI18n } from "@/lib/i18n";
import type { BestMoment, FullTimeSnapshot } from "@/hooks/useFullTimeReport";

const DISPLAY = displayFont.style.fontFamily;
const SANS = sansFont.style.fontFamily;
const MONO = monoFont.style.fontFamily;

const W = 1600;
const H = 1200;
const M = 60;
const LINE = "rgba(255,255,255,0.10)";

/** Pitch at 9 px per metre: 1080 × 720 for the 120 × 80 m canonical pitch. */
const PITCH = { x: M, y: 356, scale: 9 };

type Ctx = CanvasRenderingContext2D;

function hairline(ctx: Ctx, x1: number, y1: number, x2: number, y2: number) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1 + 0.5);
  ctx.lineTo(x2, y2 + 0.5);
  ctx.stroke();
}

function arrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const head = 6 + width * 2;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** The best moment on the pitch: the fan's moves as white arrows, the optimum in green. */
function drawBestMoment(ctx: Ctx, best: BestMoment, colors: { home: string; away: string }) {
  const { x: px, y: py, scale: s } = PITCH;
  const X = (m: number) => px + m * s;
  const Y = (m: number) => py + m * s;
  const pw = 120 * s;
  const ph = 80 * s;

  ctx.fillStyle = PALETTE.turf;
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = PALETTE.turfStripe;
  for (let i = 0; i < 12; i += 2) ctx.fillRect(px + i * 10 * s, py, 10 * s, ph);

  ctx.strokeStyle = PALETTE.pitchLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  ctx.beginPath();
  ctx.moveTo(X(60), py);
  ctx.lineTo(X(60), py + ph);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(60), Y(40), 10 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(px, Y(18), 18 * s, 44 * s);
  ctx.strokeRect(X(102), Y(18), 18 * s, 44 * s);
  ctx.strokeRect(px, Y(30), 6 * s, 20 * s);
  ctx.strokeRect(X(114), Y(30), 6 * s, 20 * s);

  const yours = new Map(best.yourMoves.map((m) => [m.player_id, m]));
  const optimum = new Map(best.optimumMoves.map((m) => [m.player_id, m]));
  const optimumTarget = best.frame.players.find((p) => p.player_id === best.optimumTargetId);

  // Best pass, from the ball to the optimum's receiver.
  if (optimumTarget) {
    const to = optimum.get(optimumTarget.player_id) ?? optimumTarget;
    ctx.setLineDash([14, 10]);
    arrow(ctx, X(best.frame.ball_x), Y(best.frame.ball_y), X(to.x), Y(to.y), PALETTE.gain, 3);
    ctx.setLineDash([]);
  }

  // Optimum positions (green rings) and the fan's moves (white arrows).
  optimum.forEach((m, id) => {
    const p = best.frame.players.find((q) => q.player_id === id);
    if (!p) return;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = withAlpha(PALETTE.gain, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(p.x), Y(p.y));
    ctx.lineTo(X(m.x), Y(m.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(X(m.x), Y(m.y), 18, 0, Math.PI * 2);
    ctx.stroke();
  });

  for (const p of best.frame.players) {
    const moved = yours.get(p.player_id);
    const color = p.team === "home" ? colors.home : colors.away;
    if (moved) {
      ctx.fillStyle = withAlpha(color, 0.25);
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 13, 0, Math.PI * 2);
      ctx.fill();
      arrow(ctx, X(p.x), Y(p.y), X(moved.x), Y(moved.y), PALETTE.fg, 3);
    }
    const x = X(moved?.x ?? p.x);
    const y = Y(moved?.y ?? p.y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = moved ? PALETTE.fg : withAlpha(PALETTE.ink, 0.6);
    ctx.lineWidth = moved ? 3 : 1.5;
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `700 14px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText(String(p.jersey_number), x, y + 5);
    ctx.textAlign = "left";
  }

  // Ball
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(best.frame.ball_x) + 9, Y(best.frame.ball_y) - 9, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A column label at 24 px, shrunk only as far as needed to fit the column width. */
function label(ctx: Ctx, text: string, x: number, y: number, maxWidth: number, color: string) {
  let size = 24;
  ctx.font = `600 ${size}px ${MONO}`;
  while (size > 16 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `600 ${size}px ${MONO}`;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Greedy word wrap; returns the y of the last line drawn. */
function wrap(ctx: Ctx, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(" ");
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines++;
      if (lines >= maxLines) {
        ctx.fillText(`${line}…`, x, y);
        return y;
      }
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y;
}

function drawReport(
  ctx: Ctx,
  snap: FullTimeSnapshot,
  opts: { nickname: string; t: ReturnType<typeof useI18n>["t"]; locale: string; language: Language }
) {
  const { t, locale, language } = opts;
  const { end, matchInfo, best } = snap;
  const you = end.leaderboard.you;

  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(0, 0, W, H);

  // Header: ident and date
  ctx.font = `800 30px ${DISPLAY}`;
  const ident = t("ft.ident");
  const identW = ctx.measureText(ident).width + 36;
  ctx.fillStyle = PALETTE.gain;
  ctx.fillRect(M, 36, identW, 50);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(ident, M + 18, 72);
  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = PALETTE.fgMuted;
  ctx.textAlign = "right";
  const nowStr = new Date().toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });
  ctx.fillText(t("ft.header", { date: nowStr.toUpperCase() }), W - M, 70);
  ctx.textAlign = "left";

  // Final score
  ctx.fillStyle = PALETTE.fg;
  ctx.font = `800 72px ${DISPLAY}`;
  ctx.fillText(
    `${matchInfo.home.name} ${end.score.home} – ${end.score.away} ${matchInfo.away.name}`.toUpperCase(),
    M,
    170
  );
  ctx.font = `600 26px ${DISPLAY}`;
  ctx.fillStyle = PALETTE.fgMuted;
  ctx.fillText(t("end.kicker").toUpperCase(), M, 210);
  hairline(ctx, M, 236, W - M, 236);

  // Position
  ctx.font = `700 34px ${DISPLAY}`;
  ctx.fillStyle = PALETTE.gain;
  ctx.fillText(opts.nickname.toUpperCase(), M, 278);
  ctx.font = `800 48px ${DISPLAY}`;
  ctx.fillStyle = PALETTE.fg;
  ctx.fillText(
    you ? t("ft.position", { rank: you.rank, n: end.leaderboard.players, pts: you.total }) : t("ft.noPosition"),
    M,
    326
  );

  const pitchW = 120 * PITCH.scale;
  const pitchH = 80 * PITCH.scale;
  const colX = PITCH.x + pitchW + 48;
  const colW = W - M - colX;
  const bottom = PITCH.y + pitchH;

  if (!best) {
    ctx.fillStyle = PALETTE.ink900;
    ctx.fillRect(PITCH.x, PITCH.y, pitchW, pitchH);
    ctx.font = `600 30px ${DISPLAY}`;
    ctx.fillStyle = PALETTE.fgMuted;
    ctx.textAlign = "center";
    ctx.fillText(t("ft.noMoments").toUpperCase(), PITCH.x + pitchW / 2, PITCH.y + pitchH / 2);
    ctx.textAlign = "left";
    return;
  }

  drawBestMoment(ctx, best, { home: matchInfo.home.primary_color, away: matchInfo.away.primary_color });

  // Legend under the pitch
  const ly = bottom + 56;
  ctx.font = `600 24px ${SANS}`;
  ctx.fillStyle = PALETTE.fg;
  ctx.fillRect(M, ly - 9, 44, 5);
  ctx.fillText(t("ft.legendYours"), M + 60, ly);
  const secondX = M + 60 + ctx.measureText(t("ft.legendYours")).width + 64;
  ctx.fillStyle = PALETTE.gain;
  ctx.fillRect(secondX, ly - 9, 44, 5);
  ctx.fillText(t("ft.legendBest"), secondX + 60, ly);

  // Best moment column, spread over the pitch's height
  let y = PITCH.y;
  label(ctx, t("ft.bestMoment").toUpperCase(), colX, y + 24, colW, PALETTE.gain);
  ctx.font = `700 48px ${DISPLAY}`;
  ctx.fillStyle = PALETTE.fg;
  ctx.fillText(`${best.event.minute}' · ${t(`challenge.mode.${best.mode}`)}`.toUpperCase(), colX, y + 80);
  ctx.font = `400 26px ${SANS}`;
  ctx.fillStyle = PALETTE.fgMuted;
  const labelEnd = wrap(ctx, best.event.labels[language] ?? best.event.event_type, colX, y + 120, colW, 32, 2);
  y = labelEnd + 30;

  const xt = (pct: number) => (pct / 100).toFixed(2);
  const gainStr = `${best.gain >= 0 ? "+" : "−"}${xt(Math.abs(best.gain))}`;
  // The figures share whatever height is left down to the bottom of the pitch: the xT change
  // as "before → after" with no label, then one line per figure with its label beside it.
  const rows: Array<[string, string, string, number]> = [
    [t(best.mode === "attack" ? "ft.gained" : "ft.prevented"), gainStr, best.gain >= 0 ? PALETTE.gain : PALETTE.loss, 76],
    [t("ft.bestPossible"), xt(best.best), PALETTE.gain, 52],
    [t("reveal.yourScore").toUpperCase(), `${best.score} / 1000`, PALETTE.fg, 52],
  ];
  const rowH = (bottom - y) / (rows.length + 1);

  // before → after
  hairline(ctx, colX, y, colX + colW, y);
  let size = 72;
  const before = xt(best.before);
  const after = xt(best.yours);
  const arrowW = 64;
  ctx.font = `700 ${size}px ${DISPLAY}`;
  while (size > 40 && ctx.measureText(before).width + ctx.measureText(after).width + arrowW + 32 > colW) {
    size -= 2;
    ctx.font = `700 ${size}px ${DISPLAY}`;
  }
  const baseline = y + rowH - 16;
  const afterW = ctx.measureText(after).width;
  ctx.textAlign = "right";
  ctx.fillStyle = PALETTE.fg;
  ctx.fillText(after, colX + colW, baseline);
  const arrowEnd = colX + colW - afterW - 16;
  const arrowY = baseline - size * 0.36;
  arrow(ctx, arrowEnd - arrowW, arrowY, arrowEnd, arrowY, PALETTE.fgMuted, 4);
  ctx.fillStyle = PALETTE.fgMuted;
  ctx.fillText(before, arrowEnd - arrowW - 16, baseline);
  ctx.textAlign = "left";
  y += rowH;

  for (const [rowLabel, value, color, valueSize] of rows) {
    hairline(ctx, colX, y, colX + colW, y);
    const valueBaseline = y + rowH - 16;
    ctx.font = `700 ${valueSize}px ${DISPLAY}`;
    const valueW = ctx.measureText(value).width;
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.fillText(value, colX + colW, valueBaseline);
    ctx.textAlign = "left";
    // Label on the value's baseline, in the room the value leaves.
    label(ctx, rowLabel, colX, valueBaseline, colW - valueW - 20, PALETTE.fgMuted);
    y += rowH;
  }
  hairline(ctx, colX, bottom, colX + colW, bottom);
}

export const FullTimeReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  snapshot: FullTimeSnapshot | null;
  nickname: string;
}> = ({ isOpen, onClose, snapshot, nickname }) => {
  const { t, locale, language } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!isOpen || !snapshot) {
      setPreviewUrl(null);
      return;
    }
    let mounted = true;
    setIsGenerating(true);
    (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx || !mounted) return;
        drawReport(ctx, snapshot, { nickname, t, locale, language });
        setPreviewUrl(canvas.toDataURL("image/png"));
      } catch (err) {
        console.error("Error generating the full-time report:", err);
      } finally {
        if (mounted) setIsGenerating(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isOpen, snapshot, nickname, t, locale, language]);

  const handleDownload = () => {
    if (!previewUrl || !snapshot) return;
    const a = document.createElement("a");
    const { home, away } = snapshot.matchInfo;
    a.download = `xT-FullTime-${home.short_name}-${away.short_name}-${snapshot.end.score.home}-${snapshot.end.score.away}.png`;
    a.href = previewUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <ModalShell
      kicker={t("export.kicker")}
      title={t("ft.title")}
      description={t("ft.desc")}
      onClose={onClose}
      className="max-w-5xl"
      headerActions={<Tag className="mr-1 hidden sm:inline-flex">PNG · 1600 × 1200</Tag>}
      bodyClassName="flex min-h-[400px] items-center justify-center bg-ink p-5"
      footer={
        <>
          <span className="text-[12px] text-fg-subtle">{t("export.ready")}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("export.cancel")}
            </Button>
            <Button variant="primary" onClick={handleDownload} disabled={isGenerating || !previewUrl}>
              {downloaded ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {downloaded ? t("export.downloaded") : t("export.download")}
            </Button>
          </div>
        </>
      }
    >
      {isGenerating ? (
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("export.generating")}
        </div>
      ) : previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={t("ft.alt")}
          className="max-h-[62vh] w-auto rounded-[3px] border border-line-strong object-contain"
        />
      ) : (
        <span className="text-[13px] text-fg-muted">{t("export.failed")}</span>
      )}
    </ModalShell>
  );
};

export default FullTimeReportModal;
