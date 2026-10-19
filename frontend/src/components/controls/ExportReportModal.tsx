"use strict";
"use client";

import React, { useState, useEffect, useRef } from "react";
import { TacticalMetrics, AgentMessage } from "@/types/match";
import { Download, X, Camera, Check, FileText, Sparkles, Shield, Cpu } from "lucide-react";

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

        // 1. Serialize SVG with inline dimensions
        const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
        svgClone.setAttribute("width", "1200");
        svgClone.setAttribute("height", "800");

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

          // Background deep slate
          const bgGrad = ctx.createLinearGradient(0, 0, width, height);
          bgGrad.addColorStop(0, "#030712");
          bgGrad.addColorStop(0.5, "#0b1329");
          bgGrad.addColorStop(1, "#020617");
          ctx.fillStyle = bgGrad;
          ctx.fillRect(0, 0, width, height);

          // Top Decorative Accent Line
          const accentGrad = ctx.createLinearGradient(0, 0, width, 0);
          accentGrad.addColorStop(0, "#10b981");
          accentGrad.addColorStop(0.5, "#06b6d4");
          accentGrad.addColorStop(1, "#f43f5e");
          ctx.fillStyle = accentGrad;
          ctx.fillRect(0, 0, width, 6);

          // ==========================================
          // HEADER SECTION
          // ==========================================
          // Logo & Title
          ctx.fillStyle = "#10b981";
          ctx.font = "bold 32px sans-serif";
          ctx.fillText("xT-WhatIf", 60, 65);

          ctx.fillStyle = "#94a3b8";
          ctx.font = "16px monospace";
          ctx.fillText("SCOUT EXECUTIVE REPORT • STATSBOMB 360", 220, 62);

          // Match Metadata Badge
          const timeStr = `${String(matchInfo.minute).padStart(2, "0")}:${String(matchInfo.second).padStart(2, "0")}`;
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 26px sans-serif";
          ctx.fillText(`Argentina vs Francia — Minuto ${timeStr} (${matchInfo.eventType})`, 60, 110);

          // Counterfactual Tag
          const modeText = matchInfo.isCounterfactual
            ? "⚡ ESCENARIO CONTRAFACTUAL SIMULADO"
            : "📌 JUGADA ORIGINAL STATSBOMB 360";
          ctx.fillStyle = matchInfo.isCounterfactual ? "#f59e0b" : "#38bdf8";
          ctx.font = "bold 14px monospace";
          ctx.fillText(modeText, 60, 138);

          // Timestamp
          ctx.fillStyle = "#64748b";
          ctx.font = "14px sans-serif";
          const nowStr = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
          ctx.fillText(`Generado: ${nowStr}`, width - 360, 65);

          // ==========================================
          // PITCH SECTION (1200 x 680 framed)
          // ==========================================
          const pitchX = 60;
          const pitchY = 160;
          const pitchW = 1480;
          const pitchH = 680;

          // Pitch frame shadow & background
          ctx.fillStyle = "#07130c";
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(pitchX, pitchY, pitchW, pitchH, 16);
          ctx.fill();
          ctx.stroke();

          // Draw pitch image
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(pitchX, pitchY, pitchW, pitchH, 16);
          ctx.clip();
          ctx.drawImage(pitchImg, pitchX, pitchY, pitchW, pitchH);
          ctx.restore();

          // ==========================================
          // METRICS SECTION (Bottom Left)
          // ==========================================
          const metricsX = 60;
          const metricsY = 865;
          const metricsW = 680;
          const metricsH = 275;

          // Metrics Card
          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(metricsX, metricsY, metricsW, metricsH, 16);
          ctx.fill();
          ctx.stroke();

          // Metrics Header
          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText("TELEMETRÍA ESPACIAL DE PELIGRO (xT)", metricsX + 24, metricsY + 38);

          // Metrics Grid (3 cols)
          const colW = (metricsW - 48) / 3;

          // Box 1: Real xT
          ctx.fillStyle = "rgba(30, 41, 59, 0.7)";
          ctx.beginPath();
          ctx.roundRect(metricsX + 24, metricsY + 55, colW - 12, 100, 10);
          ctx.fill();
          ctx.fillStyle = "#94a3b8";
          ctx.font = "12px sans-serif";
          ctx.fillText("xT REAL (BASE)", metricsX + 36, metricsY + 80);
          ctx.fillStyle = "#f1f5f9";
          ctx.font = "bold 32px monospace";
          ctx.fillText(metrics.original_xt.toFixed(2), metricsX + 36, metricsY + 125);

          // Box 2: Simulated xT
          ctx.fillStyle = "rgba(30, 41, 59, 0.7)";
          ctx.beginPath();
          ctx.roundRect(metricsX + 24 + colW, metricsY + 55, colW - 12, 100, 10);
          ctx.fill();
          ctx.fillStyle = "#f472b6";
          ctx.font = "12px sans-serif";
          ctx.fillText("xT SIMULADO", metricsX + 36 + colW, metricsY + 80);
          ctx.fillStyle = "#f472b6";
          ctx.font = "bold 32px monospace";
          ctx.fillText(metrics.simulated_xt.toFixed(2), metricsX + 36 + colW, metricsY + 125);

          // Box 3: Delta xT
          const isPos = metrics.xt_delta >= 0;
          ctx.fillStyle = isPos ? "rgba(6, 78, 59, 0.4)" : "rgba(136, 19, 55, 0.4)";
          ctx.beginPath();
          ctx.roundRect(metricsX + 24 + colW * 2, metricsY + 55, colW - 12, 100, 10);
          ctx.fill();
          ctx.fillStyle = isPos ? "#34d399" : "#fb7185";
          ctx.font = "12px sans-serif";
          ctx.fillText("ΔxT NETO", metricsX + 36 + colW * 2, metricsY + 80);
          ctx.font = "bold 32px monospace";
          const deltaStr = isPos ? `+${metrics.xt_delta.toFixed(2)}` : metrics.xt_delta.toFixed(2);
          ctx.fillText(deltaStr, metricsX + 36 + colW * 2, metricsY + 125);

          // Extra Metrics Row: Space control + Pass prob
          ctx.fillStyle = "#94a3b8";
          ctx.font = "14px sans-serif";
          ctx.fillText(`Dominio Espacial Local: ${metrics.space_control_home_pct.toFixed(1)}%`, metricsX + 28, metricsY + 195);
          ctx.fillText(`Probabilidad de Pase: ${metrics.pass_completion_prob.toFixed(1)}%`, metricsX + 360, metricsY + 195);

          ctx.fillStyle = "#64748b";
          ctx.font = "12px monospace";
          ctx.fillText("StatsBomb 360 Voronoi Tessellation & Quadratic Inertia Penalty (r=6.0m)", metricsX + 28, metricsY + 240);

          // ==========================================
          // MULTI-AGENT DEBATE SECTION (Bottom Right)
          // ==========================================
          const debateX = 760;
          const debateY = 865;
          const debateW = 780;
          const debateH = 275;

          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(debateX, debateY, debateW, debateH, 16);
          ctx.fill();
          ctx.stroke();

          // Header
          ctx.fillStyle = "#a855f7";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText("CONCLUSIONES DEL ENJAMBRE DE AGENTES IA", debateX + 24, debateY + 38);

          // Agent 1: Dr. Voronoi
          const voronoiMsg = debateMessages.find((m) => m.agent_name.includes("Voronoi"));
          const voronoiHeadline = voronoiMsg?.headline || "Optimización de Corredor xT";
          const voronoiBody = voronoiMsg?.analysis_body || "La alteración de la posición genera variaciones significativas en el Expected Threat de recepción.";

          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 14px monospace";
          ctx.fillText("🧪 DR. VORONOI [AI-QUANT]:", debateX + 24, debateY + 75);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "bold 13px sans-serif";
          ctx.fillText(voronoiHeadline, debateX + 24, debateY + 98);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "12px sans-serif";
          // Wrap content text
          const wrapText = (text: string, x: number, y: number, maxWidth: number) => {
            const words = text.split(" ");
            let line = "";
            let curY = y;
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + " ";
              const metrics = ctx.measureText(testLine);
              if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, x, curY);
                line = words[n] + " ";
                curY += 18;
                if (curY > y + 36) break; // limit lines
              } else {
                line = testLine;
              }
            }
            ctx.fillText(line, x, curY);
          };
          wrapText(voronoiBody, debateX + 24, debateY + 120, debateW - 48);

          // Agent 2: Míster Bianchi
          const bianchiMsg = debateMessages.find((m) => m.agent_name.includes("Bianchi"));
          const bianchiHeadline = bianchiMsg?.headline || "Criterio de Vestuario y Basculación";
          const bianchiBody = bianchiMsg?.analysis_body || "Ningún central retrocede tanto sin romper el achique. El rigor táctico manda.";

          ctx.fillStyle = "#f59e0b";
          ctx.font = "bold 14px monospace";
          ctx.fillText("📋 MÍSTER BIANCHI [PRO-COACH]:", debateX + 24, debateY + 175);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "bold 13px sans-serif";
          ctx.fillText(bianchiHeadline, debateX + 24, debateY + 198);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "12px sans-serif";
          wrapText(bianchiBody, debateX + 24, debateY + 220, debateW - 48);

          // ==========================================
          // FOOTER
          // ==========================================
          ctx.fillStyle = "#475569";
          ctx.font = "11px monospace";
          ctx.fillText("xT-WhatIf © 2026 — Plataforma de Inteligencia Táctica Contrafactual • Engine: StatsBomb 360 & Voronoi Tessellation", 60, height - 20);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                One-Click Scout Report (2K PNG)
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                  Alta Resolución 1600x1200
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Tarjeta ejecutiva táctica con pizarra 2D, telemetría ΔxT y dictamen de agentes IA.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Image Preview */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center bg-slate-950/50 min-h-[400px]">
          {isGenerating ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
              <span className="text-sm font-medium text-slate-300">
                Renderizando reporte táctico a 2K (Canvas nativo)...
              </span>
            </div>
          ) : previewUrl ? (
            <div className="relative max-w-full rounded-xl overflow-hidden border border-slate-700 shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Tactical Scout Report Preview"
                className="max-h-[60vh] w-auto object-contain rounded-xl"
              />
            </div>
          ) : (
            <span className="text-sm text-slate-400">No se pudo generar el reporte.</span>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Listo para exportar al cuerpo técnico o presentar a directiva.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancelar
            </button>

            <button
              onClick={handleDownload}
              disabled={isGenerating || !previewUrl}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition disabled:opacity-50"
            >
              {isCopied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>¡Descargado con Éxito!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Descargar Reporte PNG</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportReportModal;
