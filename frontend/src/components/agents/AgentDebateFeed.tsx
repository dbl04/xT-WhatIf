"use strict";
"use client";

import React from "react";
import { AgentMessage } from "@/types/match";
import { Bot, UserCheck, Sparkles, Cpu, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AgentDebateFeedProps {
  messages: AgentMessage[];
  isThinking?: boolean;
  thinkingMessage?: string;
  onHoverPlayers?: (ids: number[]) => void;
  hoveredPlayerId?: number | null;
  selectedPlayerId?: number | null;
}

export const AgentDebateFeed: React.FC<AgentDebateFeedProps> = ({
  messages,
  isThinking = false,
  thinkingMessage = "Recalculando geometría xT y consultando agentes...",
  onHoverPlayers,
  hoveredPlayerId = null,
  selectedPlayerId = null,
}) => {
  const activeFocusPlayerId = hoveredPlayerId ?? selectedPlayerId;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 tracking-wide uppercase">
            Cabina de Debate Táctico
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            2 Agentes en Línea
          </span>
        </div>
      </div>

      {/* Barra de Presencia de Agentes */}
      <div className="grid grid-cols-2 gap-2 p-3 bg-slate-900/40 border-b border-slate-800/60 text-xs">
        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-cyan-950/30 border border-cyan-800/30">
          <div className="p-1.5 rounded-lg bg-cyan-900/60 text-cyan-300">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-200 truncate text-[11px]">Dr. Voronoi</p>
            <span className="text-[9px] font-mono font-bold text-cyan-400 bg-cyan-950 px-1 rounded">
              AI-QUANT
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-amber-950/30 border border-amber-800/30">
          <div className="p-1.5 rounded-lg bg-amber-900/60 text-amber-300">
            <UserCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-200 truncate text-[11px]">Míster Bianchi</p>
            <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-950 px-1 rounded">
              PRO-COACH
            </span>
          </div>
        </div>
      </div>

      {/* Feed de Mensajes con Sincronización Bidireccional y Skeleton */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[560px]">
        {/* ============================================================== */}
        {/* SKELETON / SHIMMER STATE (ENTREGABLE 1 & 4)                     */}
        {/* ============================================================== */}
        {isThinking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="p-4 rounded-xl bg-slate-900/80 border border-cyan-600/60 shadow-xl shadow-cyan-950/50 space-y-3 relative overflow-hidden"
          >
            {/* Shimmer sweep effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent -translate-x-full animate-[shimmer_1.6s_infinite]" />

            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>{thinkingMessage}</span>
            </div>

            {/* Skeleton visual bars */}
            <div className="space-y-2 pt-1">
              <div className="h-4 bg-slate-800/90 rounded-md w-3/4 animate-pulse" />
              <div className="h-3 bg-slate-800/70 rounded-md w-full animate-pulse" />
              <div className="h-3 bg-slate-800/50 rounded-md w-5/6 animate-pulse" />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 font-mono">
              <span>Voronoi Spatial Mesh</span>
              <span className="text-cyan-400 animate-pulse">Consultando Agentes...</span>
            </div>
          </motion.div>
        )}

        {messages.length === 0 && !isThinking ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 text-xs">
            <Sparkles className="w-8 h-8 text-slate-600 mb-2 stroke-1" />
            <p>Arrastra a un jugador en la cancha para iniciar el debate entre los agentes.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {messages.map((msg, index) => {
              const isScientist = msg.agent_role === "data_scientist";

              // ==============================================================
              // SINCRONIZACIÓN INVERSA (ENTREGABLE 4):
              // Si el usuario hace hover/clic en un jugador, iluminar tarjetas
              // que lo mencionen en highlighted_player_ids
              // ==============================================================
              const isCardHighlightedByPitch =
                activeFocusPlayerId !== null &&
                msg.highlighted_player_ids.includes(activeFocusPlayerId);

              return (
                <motion.div
                  key={msg.message_id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: isCardHighlightedByPitch ? 1.025 : 1,
                  }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.22, delay: index * 0.04 }}
                  onMouseEnter={() =>
                    onHoverPlayers && onHoverPlayers(msg.highlighted_player_ids)
                  }
                  onMouseLeave={() => onHoverPlayers && onHoverPlayers([])}
                  className={`relative rounded-xl p-3.5 border transition-all duration-200 cursor-pointer ${
                    isCardHighlightedByPitch
                      ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-950 bg-slate-900/95 border-cyan-400 shadow-2xl shadow-cyan-500/30"
                      : isScientist
                      ? "bg-slate-900/90 border-cyan-800/40 hover:border-cyan-500/80 hover:shadow-lg hover:shadow-cyan-950/40"
                      : "bg-slate-900/90 border-amber-800/40 hover:border-amber-500/80 hover:shadow-lg hover:shadow-amber-950/40"
                  }`}
                >
                  {/* Badge de Sincronización Cruzada Activa */}
                  {isCardHighlightedByPitch && (
                    <div className="absolute -top-2.5 -right-1 bg-cyan-500 text-slate-950 font-mono font-bold text-[9px] px-2 py-0.5 rounded-full shadow-md animate-pulse">
                      JUGADOR EN FOCO #{activeFocusPlayerId}
                    </div>
                  )}

                  {/* Header del Mensaje */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          isScientist
                            ? "bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                            : "bg-amber-950 text-amber-300 border border-amber-800/60"
                        }`}
                      >
                        {isScientist ? (
                          <Bot className="w-3 h-3" />
                        ) : (
                          <UserCheck className="w-3 h-3" />
                        )}
                        {msg.agent_name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {msg.timestamp_label}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {msg.avatar_badge}
                    </span>
                  </div>

                  {/* Titular */}
                  <h4
                    className={`text-xs font-bold mb-1.5 leading-snug ${
                      isCardHighlightedByPitch
                        ? "text-cyan-100"
                        : isScientist
                        ? "text-cyan-200"
                        : "text-amber-200"
                    }`}
                  >
                    {msg.headline}
                  </h4>

                  {/* Cuerpo */}
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {msg.analysis_body}
                  </p>

                  {/* Métrica Citada */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">Métrica citada:</span>
                    <span className="font-mono font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                      {msg.referenced_metric}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Footer Guía de Interacción Cruzada */}
      <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
        <span>💡 Hover en la cancha resalta el debate; hover en el debate resalta la cancha.</span>
      </div>
    </div>
  );
};

export default AgentDebateFeed;
