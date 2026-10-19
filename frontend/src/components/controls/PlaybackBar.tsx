"use strict";
"use client";

import React, { useState } from "react";
import { Play, Pause, RotateCcw, FastForward, SkipBack, SkipForward, Clock, Activity } from "lucide-react";

interface PlaybackBarProps {
  minute?: number;
  second?: number;
  eventType?: string;
  isCounterfactualMode?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onResetSimulation?: () => void;
  onSpeedChange?: (speed: number) => void;
}

export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  minute = 35,
  second = 42,
  eventType = "Pass",
  isCounterfactualMode = false,
  isPlaying: externalIsPlaying,
  onTogglePlay,
  onResetSimulation,
  onSpeedChange,
}) => {
  const [internalPlaying, setInternalPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [timelineProgress, setTimelineProgress] = useState(minute);

  const isPlaying = externalIsPlaying !== undefined ? externalIsPlaying : internalPlaying;

  const handlePlayToggle = () => {
    if (onTogglePlay) {
      onTogglePlay();
    } else {
      setInternalPlaying(!internalPlaying);
    }
  };

  const handleSpeedToggle = () => {
    const nextSpeed = speed === 1 ? 2 : 1;
    setSpeed(nextSpeed);
    if (onSpeedChange) {
      onSpeedChange(nextSpeed);
    }
  };

  const formattedTime = `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

  return (
    <div className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-3 shadow-xl flex items-center justify-between gap-4">
      {/* Clock & Event */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
          <Clock className="w-4 h-4 text-emerald-400" />
          <span className="font-mono font-bold text-sm text-slate-100">
            {formattedTime}
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-900/60 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
          <Activity className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-semibold text-slate-300">Evento: {eventType}</span>
        </div>
      </div>

      {/* Scrubber & Controls */}
      <div className="flex-1 max-w-xl flex items-center gap-3">
        <button
          onClick={() => setTimelineProgress(Math.max(0, timelineProgress - 1))}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          title="Frame Anterior"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={handlePlayToggle}
          className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition shadow-lg shadow-emerald-500/20 active:scale-95"
          title={isPlaying ? "Pausar" : "Reproducir"}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>

        <button
          onClick={() => setTimelineProgress(Math.min(90, timelineProgress + 1))}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          title="Siguiente Frame"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Timeline Slider */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500">00:00</span>
          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min="0"
              max="90"
              value={timelineProgress}
              onChange={(e) => setTimelineProgress(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500">90:00</span>
        </div>
      </div>

      {/* Speed & Reset */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSpeedToggle}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono font-bold text-slate-300 transition"
          title="Velocidad de reproducción"
        >
          <FastForward className="w-3.5 h-3.5 text-slate-400" />
          {speed}x
        </button>

        <button
          onClick={onResetSimulation}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-950/60 hover:bg-pink-900/80 border border-pink-800/60 text-xs font-medium text-pink-300 transition active:scale-95"
          title="Restablecer posiciones al frame real"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restablecer
        </button>
      </div>
    </div>
  );
};

export default PlaybackBar;
