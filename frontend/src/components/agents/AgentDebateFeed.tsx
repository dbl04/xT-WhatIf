"use strict";
"use client";

import React from "react";
import { AgentMessage } from "@/types/match";
import { Bot, UserCheck, Sparkles, TrendingUp, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AgentDebateFeedProps {
  messages: AgentMessage[];
  isThinking?: boolean;
  onHoverPlayers?: (ids: number[]) => void;
}

export const AgentDebateFeed: React.FC<AgentDebateFeedProps> = ({
  messages,
  isThinking = false,
  onHoverPlayers,
}) => {
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

      {/* Agents Presence Bar */}
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

      {/* Messages Feed */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[520px]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 text-xs">
            <Sparkles className="w-8 h-8 text-slate-600 mb-2 stroke-1" />
            <p>Arrastra a un jugador en la cancha para iniciar el debate entre los agentes.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {messages.map((msg, index) => {
              const isScientist = msg.agent_role === "data_scientist";

              return (
                <motion.div
                  key={msg.message_id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.25, delay: index * 0.05 }}
                  onMouseEnter={() => onHoverPlayers && onHoverPlayers(msg.highlighted_player_ids)}
                  onMouseLeave={() => onHoverPlayers && onHoverPlayers([])}
                  className={`relative rounded-xl p-3.5 border transition-all cursor-pointer ${
                    isScientist
                      ? "bg-slate-900/90 border-cyan-800/40 hover:border-cyan-500/80 hover:shadow-lg hover:shadow-cyan-950/40"
                      : "bg-slate-900/90 border-amber-800/40 hover:border-amber-500/80 hover:shadow-lg hover:shadow-amber-950/40"
                  }`}
                >
                  {/* Message Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          isScientist
                            ? "bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                            : "bg-amber-950 text-amber-300 border border-amber-800/60"
                        }`}
                      >
                        {isScientist ? <Bot className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
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

                  {/* Headline */}
                  <h4
                    className={`text-xs font-bold mb-1.5 leading-snug ${
                      isScientist ? "text-cyan-200" : "text-amber-200"
                    }`}
                  >
                    {msg.headline}
                  </h4>

                  {/* Body */}
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {msg.analysis_body}
                  </p>

                  {/* Key Metric Callout */}
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

        {isThinking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 animate-pulse"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span>Los agentes están recalculando la telemetría espacial contrafactual...</span>
          </motion.div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <span>Pasa el cursor sobre un mensaje para iluminar a los jugadores citados.</span>
      </div>
    </div>
  );
};

export default AgentDebateFeed;
