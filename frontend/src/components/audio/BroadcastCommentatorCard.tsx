"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Volume2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Radio,
  Users,
  Play,
  Square,
} from "lucide-react";
import { AgentMessage } from "@/types/match";
import { CommentatorAvatar } from "@/components/agents/CommentatorAvatars";

interface BroadcastCommentatorCardProps {
  messages: AgentMessage[];
  activeSpeakingRole?: "data_scientist" | "classic_coach" | null;
  isSpeaking?: boolean;
  isSimulating?: boolean;
  highlightedPlayerIds?: number[];
  onHighlightPlayers?: (playerIds: number[]) => void;
  onPlaySingleMessage?: (msg: AgentMessage) => void;
  onPlayFullDebate?: () => void;
  onStopAudio?: () => void;
}

export const BroadcastCommentatorCard: React.FC<BroadcastCommentatorCardProps> = ({
  messages,
  activeSpeakingRole = null,
  isSpeaking = false,
  isSimulating = false,
  onHighlightPlayers,
  onPlaySingleMessage,
  onPlayFullDebate,
  onStopAudio,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  // Cuando el TTS cambia de locutor o llegan nuevos mensajes tras arrastrar un jugador,
  // abrimos automáticamente el Lower-Third y enfocamos al comentarista que habla
  useEffect(() => {
    if (activeSpeakingRole) {
      const idx = messages.findIndex((m) => m.agent_role === activeSpeakingRole);
      if (idx !== -1) {
        setSelectedIndex(idx);
        setIsMinimized(false);
      }
    }
  }, [activeSpeakingRole, messages]);

  // Al cambiar de jugada o recibir una nueva simulación contrafactual, mostrar la tarjeta
  useEffect(() => {
    if (messages.length > 0) {
      setSelectedIndex(0);
      setIsMinimized(false);
    }
  }, [messages]);

  const currentMessage = messages[selectedIndex] || messages[0];

  // Iluminar en el césped los jugadores citados por la tarjeta visible
  useEffect(() => {
    if (!isMinimized && currentMessage && onHighlightPlayers) {
      onHighlightPlayers(currentMessage.highlighted_player_ids || []);
    } else if (isMinimized && onHighlightPlayers) {
      onHighlightPlayers([]);
    }
  }, [currentMessage, isMinimized, onHighlightPlayers]);

  if (!currentMessage && !isSimulating) return null;

  const isQuant = currentMessage?.agent_role === "data_scientist";
  const currentlyTalkingThisCard =
    isSpeaking &&
    (!activeSpeakingRole || activeSpeakingRole === currentMessage?.agent_role);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center px-4">
      <AnimatePresence mode="wait">
        {isSimulating ? (
          /* ESTADO SHIMMER MIENTRAS RECALCULA EL SWARM */
          <motion.div
            key="simulating-lower-third"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-cyan-400/40 bg-slate-950/90 px-6 py-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.75)] backdrop-blur-xl"
          >
            <Sparkles className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-sm font-semibold tracking-wide text-slate-100">
              Recalculando geometría xT 16×12 y sintetizando debate en la cabina...
            </span>
          </motion.div>
        ) : isMinimized ? (
          /* PÍLDORA COMPACTA MINIMIZADA (100% VISIBILIDAD DE CANCHA) */
          <motion.div
            key="minimized-pill"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-700/80 bg-slate-950/90 px-4 py-2 shadow-2xl backdrop-blur-xl"
          >
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              🎙️ Cabina Táctica IA ({messages.length} intervenciones)
            </span>
            {onPlayFullDebate && (
              <button
                onClick={onPlayFullDebate}
                className="flex items-center gap-1.5 rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/30 transition"
              >
                <Volume2 className="h-3.5 w-3.5" />
                Escuchar Debate
              </button>
            )}
            <button
              onClick={() => setIsMinimized(false)}
              className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              Abrir Lower-Third
            </button>
          </motion.div>
        ) : (
          /* LOWER-THIRD TELEVISIVO COMPLETO */
          <motion.div
            key={`card-${currentMessage.message_id || selectedIndex}`}
            initial={{ y: 110, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 110, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className={`pointer-events-auto relative w-full max-w-4xl overflow-hidden rounded-2xl border backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] transition-colors ${
              isQuant
                ? "border-cyan-400/50 bg-gradient-to-r from-slate-950/95 via-slate-900/95 to-cyan-950/85"
                : "border-amber-400/50 bg-gradient-to-r from-slate-950/95 via-slate-900/95 to-amber-950/85"
            }`}
          >
            {/* Barra superior de sintonía estilo Premier League Broadcast */}
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest ${
                    currentlyTalkingThisCard
                      ? "bg-rose-600 text-white animate-pulse"
                      : isQuant
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/30"
                      : "bg-amber-500/20 text-amber-300 border border-amber-400/30"
                  }`}
                >
                  <Radio className="h-3 w-3" />
                  {currentlyTalkingThisCard ? "ON AIR • LIVE VOICE" : currentMessage.avatar_badge}
                </span>

                {/* Selector de comentarista (1/2 Dr. Voronoi vs 2/2 Míster Bianchi) */}
                <div className="ml-2 flex items-center gap-1 rounded-lg bg-slate-900/90 p-0.5 border border-slate-800">
                  {messages.map((msg, idx) => {
                    const active = idx === selectedIndex;
                    const quantTab = msg.agent_role === "data_scientist";
                    return (
                      <button
                        key={msg.message_id || idx}
                        onClick={() => setSelectedIndex(idx)}
                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                          active
                            ? quantTab
                              ? "bg-cyan-500 text-slate-950 shadow-sm"
                              : "bg-amber-400 text-slate-950 shadow-sm"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {quantTab ? "1. Dr. Voronoi [QUANT]" : "2. Míster Bianchi [COACH]"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Controles de Audio y Minimizar */}
              <div className="flex items-center gap-2">
                {onPlaySingleMessage && (
                  <button
                    onClick={() =>
                      currentlyTalkingThisCard && onStopAudio
                        ? onStopAudio()
                        : onPlaySingleMessage(currentMessage)
                    }
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      currentlyTalkingThisCard
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                        : isQuant
                        ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                        : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    }`}
                  >
                    {currentlyTalkingThisCard ? (
                      <>
                        <Square className="h-3 w-3 fill-current" /> Detener Voz
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current" /> Escuchar Turno
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={() => setIsMinimized(true)}
                  title="Minimizar tarjeta para despejar la cancha"
                  className="rounded-lg bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Cuerpo Principal del Lower-Third: Avatar SVG + Análisis + Chips Métricos */}
            <div className="flex items-center gap-5 px-5 py-3.5">
              <CommentatorAvatar
                isSpeaking={currentlyTalkingThisCard}
                role={currentMessage.agent_role}
                size={84}
              />

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-extrabold uppercase tracking-wider ${
                      isQuant ? "text-cyan-400" : "text-amber-400"
                    }`}
                  >
                    {currentMessage.agent_name}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    • {currentMessage.timestamp_label}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-mono font-bold ${
                      isQuant
                        ? "bg-cyan-500/15 text-cyan-300 border border-cyan-400/30"
                        : "bg-amber-500/15 text-amber-300 border border-amber-400/30"
                    }`}
                  >
                    {currentMessage.referenced_metric}
                  </span>
                </div>

                <h4 className="text-base font-extrabold text-white leading-snug mb-1 truncate">
                  &ldquo;{currentMessage.headline}&rdquo;
                </h4>

                <p className="text-xs sm:text-sm text-slate-200/95 leading-relaxed line-clamp-2">
                  {currentMessage.analysis_body}
                </p>

                {currentMessage.highlighted_player_ids?.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                    <Users className="h-3.5 w-3.5 text-emerald-400" />
                    <span>
                      Jugadores iluminados en cancha:{" "}
                      <strong className="text-slate-200">
                        #{currentMessage.highlighted_player_ids.join(", #")}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
