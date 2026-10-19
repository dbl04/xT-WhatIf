"use strict";
"use client";

import React, { useState, useEffect } from "react";
import { MatchFramePayload } from "@/types/match";
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  SkipBack,
  SkipForward,
  Clock,
  Activity,
  Film,
  Sparkles,
} from "lucide-react";

interface PlaybackBarProps {
  frames?: MatchFramePayload[];
  currentFrameIndex?: number;
  onSelectFrameIndex?: (index: number) => void;
  minute?: number;
  second?: number;
  eventType?: string;
  isCounterfactualMode?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onResetSimulation?: () => void;
  onSpeedChange?: (speed: number) => void;
}

// Descripciones tácticas canónicas para los 5 momentos clave de la Final 2022
function getMomentLabel(frame: MatchFramePayload, index: number): string {
  if (frame.minute === 21 && frame.second === 18) {
    return "21:18 - Penalti a Di María (1-0 Argentina)";
  }
  if (frame.minute === 35 && frame.second === 42) {
    return "35:42 - Gol de Di María (Pase de Mac Allister 2-0)";
  }
  if ((frame.minute === 79 || frame.minute === 80) && (frame.second === 15 || frame.second === 25)) {
    return "80:25 - Gol de Mbappé (Volea tras robo de Coman 2-2)";
  }
  if (frame.minute === 108 && frame.second === 31) {
    return "108:31 - Gol de Messi en la prórroga (3-2 Argentina)";
  }
  if (frame.minute === 122 && frame.second === 43) {
    return "122:43 - Parada histórica de Dibu Martínez a Kolo Muani";
  }
  const minStr = String(frame.minute).padStart(2, "0");
  const secStr = String(frame.second).padStart(2, "0");
  const teamLabel = frame.possession_team === "home" ? "Argentina" : "Francia";
  return `${minStr}:${secStr} - ${frame.event_type} (${teamLabel})`;
}

export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  frames = [],
  currentFrameIndex = 0,
  onSelectFrameIndex,
  minute = 35,
  second = 42,
  eventType = "Pass",
  isCounterfactualMode = false,
  isPlaying: externalIsPlaying,
  onTogglePlay,
  onResetSimulation,
  onSpeedChange,
}) => {
  const [internalPlaying, setInternalPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);
  const [timelineProgress, setTimelineProgress] = useState<number>(minute);

  const isPlaying = externalIsPlaying !== undefined ? externalIsPlaying : internalPlaying;

  // Actualiza progreso al cambiar el frame
  useEffect(() => {
    setTimelineProgress(minute);
  }, [minute]);

  const handlePlayToggle = () => {
    if (onTogglePlay) {
      onTogglePlay();
    } else {
      setInternalPlaying(!internalPlaying);
    }
  };

  const handleSpeedToggle = () => {
    // Cicla entre 0.5x -> 1x -> 2x -> 0.5x
    let nextSpeed = 1;
    if (speed === 0.5) nextSpeed = 1;
    else if (speed === 1) nextSpeed = 2;
    else if (speed === 2) nextSpeed = 0.5;

    setSpeed(nextSpeed);
    if (onSpeedChange) {
      onSpeedChange(nextSpeed);
    }
  };

  const formattedTime = `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

  return (
    <div className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-3.5 shadow-2xl flex flex-wrap items-center justify-between gap-4">
      {/* Reloj y Selector Rápido de Jugadas Clave (Match Moment Selector) */}
      <div className="flex items-center gap-3">
        {/* Reloj Oficial */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
          <Clock className="w-4 h-4 text-emerald-400" />
          <span className="font-mono font-bold text-sm text-slate-100">
            {formattedTime}
          </span>
        </div>

        {/* ============================================================== */}
        {/* MATCH MOMENT SELECTOR (ENTREGABLE 3)                           */}
        {/* ============================================================== */}
        <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl shadow-inner">
          <Film className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">
            Jugada Clave:
          </span>
          <select
            value={currentFrameIndex}
            onChange={(e) => {
              const idx = Number(e.target.value);
              if (onSelectFrameIndex) {
                onSelectFrameIndex(idx);
              }
            }}
            className="bg-transparent text-xs font-semibold text-cyan-200 outline-none cursor-pointer pr-1"
          >
            {frames.map((f, i) => (
              <option key={`${f.event_uuid || "moment"}-${i}`} value={i} className="bg-slate-900 text-slate-200">
                {getMomentLabel(f, i)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Controles de Reproducción y Scrubber Central */}
      <div className="flex-1 max-w-xl flex items-center gap-3">
        <button
          onClick={() => {
            if (onSelectFrameIndex && currentFrameIndex > 0) {
              onSelectFrameIndex(currentFrameIndex - 1);
            }
          }}
          disabled={currentFrameIndex <= 0}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition disabled:opacity-40"
          title="Jugada Anterior"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={handlePlayToggle}
          className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition shadow-lg shadow-emerald-500/20 active:scale-95"
          title={isPlaying ? "Pausar" : "Reproducir"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={() => {
            if (onSelectFrameIndex && currentFrameIndex < frames.length - 1) {
              onSelectFrameIndex(currentFrameIndex + 1);
            }
          }}
          disabled={currentFrameIndex >= frames.length - 1}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition disabled:opacity-40"
          title="Siguiente Jugada"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Timeline Slider Scrubber */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500">00:00</span>
          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min="0"
              max="125"
              value={timelineProgress}
              onChange={(e) => {
                const newMin = Number(e.target.value);
                setTimelineProgress(newMin);
                if (onSelectFrameIndex && frames.length > 0) {
                  let closestIdx = 0;
                  let minDiff = Math.abs(frames[0].minute - newMin);
                  for (let i = 1; i < frames.length; i++) {
                    const diff = Math.abs(frames[i].minute - newMin);
                    if (diff < minDiff) {
                      minDiff = diff;
                      closestIdx = i;
                    }
                  }
                  if (closestIdx !== currentFrameIndex) {
                    onSelectFrameIndex(closestIdx);
                  }
                }
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500">125:00</span>
        </div>
      </div>

      {/* Velocidad y Botón Ámbar de Reseteo (Entregable 3) */}
      <div className="flex items-center gap-2.5">
        {/* Selector de Velocidad */}
        <button
          onClick={handleSpeedToggle}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono font-bold text-slate-300 transition"
          title="Alternar velocidad (0.5x, 1x, 2x)"
        >
          <FastForward className="w-3.5 h-3.5 text-slate-400" />
          {speed}x
        </button>

        {/* ============================================================== */}
        {/* BOTÓN ÁMBAR: RESETEAR SIMULACIÓN (VOLVER A REALIDAD)           */}
        {/* ============================================================== */}
        <button
          onClick={onResetSimulation}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-medium text-xs transition active:scale-95 shadow-md ${
            isCounterfactualMode
              ? "bg-amber-950/80 hover:bg-amber-900 border border-amber-600/80 text-amber-300 shadow-amber-950/60 animate-pulse"
              : "bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400"
          }`}
          title="Restablecer posiciones al frame real de StatsBomb 360"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Resetear Simulación (Volver a Realidad)</span>
        </button>
      </div>
    </div>
  );
};

export default PlaybackBar;
