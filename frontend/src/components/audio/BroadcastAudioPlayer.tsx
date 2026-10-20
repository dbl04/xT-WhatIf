"use strict";
"use client";

import React from "react";
import { AgentMessage } from "@/types/match";
import { useBroadcastTTS } from "@/hooks/useBroadcastTTS";
import { Volume2, VolumeX, Play, Square, Mic, Radio } from "lucide-react";
import { motion } from "framer-motion";

export interface BroadcastAudioProps {
  messages: AgentMessage[];
  autoPlayOnNewSimulation?: boolean;
  onActiveSpeakerChange?: (
    role: "data_scientist" | "classic_coach" | null,
    highlightedPlayerIds: number[]
  ) => void;
}

export const BroadcastAudioPlayer: React.FC<BroadcastAudioProps> = ({
  messages,
  autoPlayOnNewSimulation = false,
  onActiveSpeakerChange,
}) => {
  const {
    isPlaying,
    isMuted,
    activeSpeaker,
    activeMessageIndex,
    play,
    stop,
    toggleMute,
  } = useBroadcastTTS({
    messages,
    autoPlayOnNewSimulation,
    onActiveSpeakerChange,
  });

  const equalizerBars = Array.from({ length: 16 });

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-xl backdrop-blur-md">
      {/* Speaker Status Indicator */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`p-2 rounded-xl border transition-all duration-300 ${
            isPlaying
              ? activeSpeaker === "data_scientist"
                ? "bg-cyan-950/80 border-cyan-500/60 text-cyan-300 shadow-lg shadow-cyan-500/20"
                : "bg-amber-950/80 border-amber-500/60 text-amber-300 shadow-lg shadow-amber-500/20"
              : "bg-slate-900 border-slate-800 text-slate-500"
          }`}
        >
          {isPlaying ? (
            <Radio className="w-4 h-4 animate-pulse" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
              Dual-Voice Neural Feed
            </span>
            {isPlaying && (
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
            )}
          </div>

          <div className="text-xs font-semibold truncate">
            {!isPlaying ? (
              <span className="text-slate-400">Cabina de Audio en Espera</span>
            ) : activeSpeaker === "data_scientist" ? (
              <span className="text-cyan-400 font-bold tracking-wide">
                🎙️ HABLANDO: DR. VORONOI <span className="text-[9px] font-mono bg-cyan-950 px-1 py-0.5 rounded border border-cyan-800/60 ml-1">[AI-QUANT]</span>
              </span>
            ) : (
              <span className="text-amber-400 font-bold tracking-wide">
                🎙️ HABLANDO: MÍSTER BIANCHI <span className="text-[9px] font-mono bg-amber-950 px-1 py-0.5 rounded border border-amber-800/60 ml-1">[PRO-COACH]</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 16-Bar Animated Equalizer */}
      <div className="flex items-center gap-1 h-6 px-3 py-1 bg-slate-900/60 rounded-xl border border-slate-800/60">
        {equalizerBars.map((_, i) => (
          <motion.div
            key={i}
            className={`w-1 rounded-full ${
              !isPlaying
                ? "bg-slate-700/40 h-1.5"
                : activeSpeaker === "data_scientist"
                ? "bg-gradient-to-t from-cyan-600 to-teal-300"
                : "bg-gradient-to-t from-amber-600 to-orange-300"
            }`}
            animate={
              isPlaying
                ? {
                    height: [
                      "4px",
                      `${Math.sin((i + 1) * 0.8) * 12 + 10}px`,
                      "6px",
                      `${Math.cos((i + 1) * 0.6) * 14 + 8}px`,
                      "4px",
                    ],
                  }
                : { height: "4px" }
            }
            transition={{
              repeat: isPlaying ? Infinity : 0,
              duration: 0.6 + (i % 5) * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {!isPlaying ? (
          <button
            onClick={play}
            disabled={messages.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Escuchar Debate en Vivo</span>
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-semibold text-xs active:scale-95 transition"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Detener</span>
          </button>
        )}

        <button
          onClick={toggleMute}
          className={`p-1.5 rounded-xl border transition active:scale-95 ${
            isMuted
              ? "bg-rose-950/60 border-rose-800 text-rose-400"
              : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
          }`}
          title={isMuted ? "Activar audio" : "Silenciar"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
