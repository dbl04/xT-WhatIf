"use strict";
"use client";

import React, { useState, useEffect, useRef } from "react";
import { TacticalMetrics, AgentMessage } from "@/types/match";
import { Download, Check, Loader2 } from "lucide-react";
import { Button, ModalShell, Tag } from "@/components/ui/primitives";
import { displayFont, sansFont, monoFont } from "@/lib/fonts";
import { PALETTE } from "@/lib/palette";

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getSvgElement: () => SVGSVGElement | null;
  matchInfo: {
    minute: number;
    second: number;
    eventType: string;
    isCounterfactual: boolean;
    possessionTeam: "home" | "away";
  };
  metrics: TacticalMetrics;
  debateMessages: AgentMessage[];
}

const R = {
  ink: PALETTE.ink,
  panel: PALETTE.ink900,
  line: "rgba(255,255,255,0.10)",
  fg: PALETTE.fg,
  muted: PALETTE.fgMuted,
  subtle: PALETTE.fgSubtle,
  green: PALETTE.green,
  magenta: PALETTE.magenta,
  home: PALETTE.home,
  turf: PALETTE.turf,
};

/** Size the pitch SVG is rasterised at, and the box it is drawn into on the report. */
const SVG_RENDER_W = 1200;
const SVG_RENDER_H = 800;
const PITCH_DRAW_W = 960;
const PITCH_DRAW_H = 640;
/** On-screen hairlines are thickened by this factor so they stay legible in print. */
const EXPORT_STROKE_BOOST = 2.5;

/**
 * Screen hairlines use `vector-effect: non-scaling-stroke` (fixed px width). Rasterised at
 * 1200px and then shrunk onto the report they would end up ~0.4px wide and vanish, so convert
 * them to user-space widths that land at roughly `px * EXPORT_STROKE_BOOST` on the final PNG.
 */
function thickenHairlinesForExport(svg: SVGSVGElement, viewBoxWidth: number) {
  const userUnitsPerDrawnPx = viewBoxWidth / PITCH_DRAW_W;
  svg.querySelectorAll("[vector-effect='non-scaling-stroke']").forEach((el) => {
    const px = parseFloat(el.getAttribute("stroke-width") || "1");
    el.removeAttribute("vector-effect");
    el.setAttribute("stroke-width", String(px * EXPORT_STROKE_BOOST * userUnitsPerDrawnPx));
    // Dash lengths were screen pixels too; keep them proportional to the thicker stroke.
    const dash = el.getAttribute("stroke-dasharray");
    if (dash) {
      const scaled = dash
        .split(/[\s,]+/)
        .map((d) => parseFloat(d) * EXPORT_STROKE_BOOST * userUnitsPerDrawnPx);
      el.setAttribute("stroke-dasharray", scaled.join(" "));
    }
  });
}

const DISPLAY = displayFont.style.fontFamily;
const SANS = sansFont.style.fontFamily;
const MONO = monoFont.style.fontFamily;

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  getSvgElement,
  matchInfo,
  metrics,
  debateMessages,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Generate High-Res Tactical Canvas
  useEffect(() => {
    if (!isOpen) {
      setPreviewUrl(null);
      return;
    }

    let isMounted = true;
    setIsGenerating(true);

    const generateReport = async () => {
      try {
        const svgEl = getSvgElement();
        if (!svgEl) {
          setIsGenerating(false);
          return;
        }

        // Make sure the broadcast faces are ready before painting text
        if (document.fonts?.ready) await document.fonts.ready;

        // 1. Serialize SVG with inline dimensions
        const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
        svgClone.setAttribute("width", String(SVG_RENDER_W));
        svgClone.setAttribute("height", String(SVG_RENDER_H));
        thickenHairlinesForExport(svgClone, svgEl.viewBox.baseVal.width || 120);

        const svgString = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const URL = window.URL || window.webkitURL || window;
        const blobUrl = URL.createObjectURL(svgBlob);

        const pitchImg = new Image();
        pitchImg.crossOrigin = "anonymous";

        pitchImg.onload = () => {
          if (!isMounted) {
            URL.revokeObjectURL(blobUrl);
            return;
          }

          // 2. Setup 2K High Resolution Canvas (1600 x 1200)
          const width = 1600;
          const height = 1200;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            URL.revokeObjectURL(blobUrl);
            setIsGenerating(false);
            return;
          }

          const M = 60; // outer margin
          const hairline = (x1: number, y1: number, x2: number, y2: number) => {
            ctx.strokeStyle = R.line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1 + 0.5);
            ctx.lineTo(x2, y2 + 0.5);
            ctx.stroke();
          };
          const wrapText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) => {
            const words = text.split(" ");
            let line = "";
            let lines = 0;
            let curY = y;
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + " ";
              if (ctx.measureText(testLine).width > maxWidth && n > 0) {
                lines++;
                if (lines >= maxLines) {
                  ctx.fillText(line.trimEnd() + "…", x, curY);
                  return;
                }
                ctx.fillText(line, x, curY);
                line = words[n] + " ";
                curY += lineHeight;
              } else {
                line = testLine;
              }
            }
            ctx.fillText(line, x, curY);
          };

          // Background
          ctx.fillStyle = R.ink;
          ctx.fillRect(0, 0, width, height);

          // ==========================================
          // HEADER
          // ==========================================
          // Programme ident
          ctx.font = `800 20px ${DISPLAY}`;
          const ident = "TACTICAL ANALYSIS";
          const identW = ctx.measureText(ident).width + 28;
          ctx.fillStyle = R.green;
          ctx.fillRect(M, 44, identW, 34);
          ctx.fillStyle = R.ink;
          ctx.fillText(ident, M + 14, 68);

          ctx.font = `500 13px ${MONO}`;
          ctx.fillStyle = R.subtle;
          ctx.textAlign = "right";
          const nowStr = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
          ctx.fillText(`xT/WHATIF · SCOUT REPORT · ${nowStr.toUpperCase()}`, width - M, 66);
          ctx.textAlign = "left";

          // Fixture headline
          const timeStr = `${String(matchInfo.minute).padStart(2, "0")}:${String(matchInfo.second).padStart(2, "0")}`;
          ctx.fillStyle = R.fg;
          ctx.font = `800 64px ${DISPLAY}`;
          ctx.fillText("ARGENTINA v FRANCIA", M, 142);

          ctx.font = `600 22px ${DISPLAY}`;
          ctx.fillStyle = R.muted;
          ctx.fillText(
            `FINAL · COPA DEL MUNDO 2022 · ${timeStr} · ${matchInfo.eventType.toUpperCase()}`,
            M,
            176
          );

          // Mode tag
          const modeText = matchInfo.isCounterfactual ? "ESCENARIO SIMULADO" : "JUGADA REAL · STATSBOMB 360";
          ctx.font = `600 13px ${MONO}`;
          const modeW = ctx.measureText(modeText).width + 20;
          ctx.strokeStyle = matchInfo.isCounterfactual ? R.green : R.fg;
          ctx.lineWidth = 1;
          ctx.strokeRect(width - M - modeW + 0.5, 150.5, modeW, 28);
          ctx.fillStyle = matchInfo.isCounterfactual ? R.green : R.fg;
          ctx.fillText(modeText, width - M - modeW + 10, 169);

          hairline(M, 204, width - M, 204);

          // ==========================================
          // PITCH (keeps the native 3:2 aspect)
          // ==========================================
          const pitchX = M;
          const pitchY = 232;
          const pitchW = PITCH_DRAW_W;
          const pitchH = PITCH_DRAW_H;
          ctx.fillStyle = R.turf;
          ctx.fillRect(pitchX, pitchY, pitchW, pitchH);
          ctx.drawImage(pitchImg, pitchX, pitchY, pitchW, pitchH);

          // ==========================================
          // METRICS COLUMN
          // ==========================================
          const colX = pitchX + pitchW + 48;
          const colW = width - M - colX;
          let y = pitchY;

          ctx.font = `600 12px ${MONO}`;
          ctx.fillStyle = R.subtle;
          ctx.fillText("EXPECTED THREAT", colX, y + 12);
          y += 28;

          const isPos = metrics.xt_delta >= 0;
          const statRows: Array<[string, string, string]> = [
            ["xT REAL", metrics.original_xt.toFixed(2), R.muted],
            ["xT SIMULADO", metrics.simulated_xt.toFixed(2), R.fg],
            ["Δ xT", isPos ? `+${metrics.xt_delta.toFixed(2)}` : metrics.xt_delta.toFixed(2), isPos ? R.green : R.magenta],
          ];
          statRows.forEach(([label, value, color]) => {
            hairline(colX, y, colX + colW, y);
            ctx.font = `500 13px ${MONO}`;
            ctx.fillStyle = R.subtle;
            ctx.fillText(label, colX, y + 32);
            ctx.font = `700 76px ${DISPLAY}`;
            ctx.fillStyle = color;
            ctx.textAlign = "right";
            ctx.fillText(value, colX + colW, y + 86);
            ctx.textAlign = "left";
            y += 112;
          });
          hairline(colX, y, colX + colW, y);
          y += 36;

          // Territorial split
          const homePct = Math.max(0, Math.min(100, metrics.space_control_home_pct));
          ctx.font = `500 13px ${MONO}`;
          ctx.fillStyle = R.subtle;
          ctx.fillText("CONTROL TERRITORIAL", colX, y);
          y += 16;
          ctx.fillStyle = R.home;
          ctx.fillRect(colX, y, (colW * homePct) / 100, 8);
          ctx.fillStyle = "rgba(244,240,248,0.8)";
          ctx.fillRect(colX + (colW * homePct) / 100, y, colW - (colW * homePct) / 100, 8);
          y += 36;
          ctx.font = `600 22px ${DISPLAY}`;
          ctx.fillStyle = R.home;
          ctx.fillText(`ARG ${homePct.toFixed(1)}%`, colX, y);
          ctx.fillStyle = R.muted;
          ctx.textAlign = "right";
          ctx.fillText(`${(100 - homePct).toFixed(1)}% FRA`, colX + colW, y);
          ctx.textAlign = "left";
          y += 44;

          // Pass probability
          const passPct = Math.max(0, Math.min(100, metrics.pass_completion_prob));
          ctx.font = `500 13px ${MONO}`;
          ctx.fillStyle = R.subtle;
          ctx.fillText("PROBABILIDAD DE PASE", colX, y);
          ctx.font = `600 22px ${DISPLAY}`;
          ctx.fillStyle = R.fg;
          ctx.textAlign = "right";
          ctx.fillText(`${passPct.toFixed(1)}%`, colX + colW, y + 2);
          ctx.textAlign = "left";
          y += 16;
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(colX, y, colW, 8);
          ctx.fillStyle = R.fg;
          ctx.fillRect(colX, y, (colW * passPct) / 100, 8);

          // ==========================================
          // PUNDITS (bottom band)
          // ==========================================
          const bandY = pitchY + pitchH + 36;
          hairline(M, bandY - 18, width - M, bandY - 18);
          const punditW = (width - M * 2 - 40) / 2;

          const pundits = [
            {
              msg: debateMessages.find((m) => m.agent_role === "data_scientist"),
              name: "DR. VORONOI",
              role: "Analista de datos",
              headline: "Optimización de corredor xT",
              body: "La alteración de la posición genera variaciones significativas en el Expected Threat de recepción.",
            },
            {
              msg: debateMessages.find((m) => m.agent_role === "classic_coach"),
              name: "MÍSTER BIANCHI",
              role: "Analista táctico",
              headline: "Criterio de vestuario y basculación",
              body: "Ningún central retrocede tanto sin romper el achique. El rigor táctico manda.",
            },
          ];

          pundits.forEach((p, i) => {
            const x = M + i * (punditW + 40);
            const name = p.name;

            // Name plate
            ctx.font = `800 24px ${DISPLAY}`;
            const plateW = ctx.measureText(name).width + 28;
            ctx.fillStyle = R.fg;
            ctx.fillRect(x, bandY, plateW, 38);
            ctx.fillStyle = R.ink;
            ctx.fillText(name, x + 14, bandY + 28);
            ctx.font = `500 13px ${SANS}`;
            ctx.fillStyle = R.subtle;
            ctx.fillText(p.role, x + plateW + 14, bandY + 25);

            ctx.font = `700 28px ${DISPLAY}`;
            ctx.fillStyle = R.fg;
            wrapText(p.msg?.headline || p.headline, x, bandY + 82, punditW, 30, 1);

            ctx.font = `400 16px ${SANS}`;
            ctx.fillStyle = R.muted;
            wrapText(p.msg?.analysis_body || p.body, x, bandY + 114, punditW, 24, 3);
          });

          // ==========================================
          // FOOTER
          // ==========================================
          hairline(M, height - 52, width - M, height - 52);
          ctx.font = `500 12px ${MONO}`;
          ctx.fillStyle = R.subtle;
          ctx.fillText("xT-WhatIf © 2026 · Inteligencia táctica contrafactual · StatsBomb 360 · Teselación de Voronoi · Penalización de inercia r = 6,0 m", M, height - 24);

          URL.revokeObjectURL(blobUrl);

          const finalUrl = canvas.toDataURL("image/png");
          setPreviewUrl(finalUrl);
          setIsGenerating(false);
        };

        pitchImg.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          setIsGenerating(false);
        };

        pitchImg.src = blobUrl;
      } catch (err) {
        console.error("Error generating scout report:", err);
        setIsGenerating(false);
      }
    };

    generateReport();

    return () => {
      isMounted = false;
    };
  }, [isOpen, getSvgElement, matchInfo, metrics, debateMessages]);

  const handleDownload = () => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    const timeStr = `${String(matchInfo.minute).padStart(2, "0")}${String(matchInfo.second).padStart(2, "0")}`;
    const mode = matchInfo.isCounterfactual ? "WhatIf-Simulated" : "Real-Base";
    a.download = `xT-Scout-Report-Final2022-Min${timeStr}-${mode}.png`;
    a.href = previewUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <ModalShell
      kicker="Exportar"
      title="Informe táctico"
      description="Pizarra, métricas de xT y lectura de los analistas en un PNG de 1600 × 1200."
      onClose={onClose}
      className="max-w-5xl"
      headerActions={<Tag className="mr-1 hidden sm:inline-flex">PNG · 1600 × 1200</Tag>}
      bodyClassName="flex min-h-[400px] items-center justify-center bg-ink p-5"
      footer={
        <>
          <span className="text-[12px] text-fg-subtle">Listo para compartir con el cuerpo técnico.</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleDownload} disabled={isGenerating || !previewUrl}>
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {isCopied ? "Descargado" : "Descargar PNG"}
            </Button>
          </div>
        </>
      }
    >
      {isGenerating ? (
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generando informe…
        </div>
      ) : previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Vista previa del informe táctico"
          className="max-h-[62vh] w-auto rounded-[3px] border border-line-strong object-contain"
        />
      ) : (
        <span className="text-[13px] text-fg-muted">No se pudo generar el informe.</span>
      )}
    </ModalShell>
  );
};

export default ExportReportModal;
