"use strict";
"use client";

import React, { useState, useEffect } from "react";
import { MatchFramePayload } from "@/types/match";
import { Play, Pause, RotateCcw, SkipBack, SkipForward, ChevronDown } from "lucide-react";
import { Button, IconButton } from "@/components/ui/primitives";
import { formatMomentLabel } from "@/lib/match";
import { useI18n } from "@/lib/i18n";

const SPEEDS = [0.5, 1, 2] as const;
const TIMELINE_MAX = 125;
const TIMELINE_MARKS = [
  { minute: 45, label: "45'" },
  { minute: 90, label: "90'" },
  { minute: 120, label: "120'" },
];

interface PlaybackBarProps {
  frames?: MatchFramePayload[];
  currentFrameIndex?: number;
  onSelectFrameIndex?: (index: number) => void;
  onSelectFrame?: (index: number) => void;
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
  frames = [],
  currentFrameIndex = 0,
  onSelectFrameIndex,
  onSelectFrame,
  minute = 35,
  second = 42,
  eventType = "Pass",
  isCounterfactualMode = false,
  isPlaying: externalIsPlaying,
  onTogglePlay,
  onResetSimulation,
  onSpeedChange,
}) => {
  const { t } = useI18n();
  const [internalPlaying, setInternalPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);

  // Keep the timeline in sync using decimal time (minute + second / 60)
  const currentDecimalTime = minute + (second || 0) / 60;
  const [timelineProgress, setTimelineProgress] = useState<number>(currentDecimalTime);

  const isPlaying = externalIsPlaying !== undefined ? externalIsPlaying : internalPlaying;
  const selectFrame = onSelectFrame || onSelectFrameIndex;

  // Update progress when the frame changes
  useEffect(() => {
    setTimelineProgress(minute + (second || 0) / 60);
  }, [minute, second]);

  const handlePlayToggle = () => {
    if (onTogglePlay) {
      onTogglePlay();
    } else {
      setInternalPlaying(!internalPlaying);
    }
  };

  const handleSpeedSelect = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    if (onSpeedChange) {
      onSpeedChange(nextSpeed);
    }
  };

  // Interactive scrubber: jump to the frame closest to the dragged minute
  const handleSliderChange = (newVal: number) => {
    setTimelineProgress(newVal);
    if (!frames || frames.length === 0) return;

    let closestIdx = 0;
    let minDiff = Infinity;
    frames.forEach((f, idx) => {
      const fTime = f.minute + (f.second || 0) / 60;
      const diff = Math.abs(fTime - newVal);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    if (selectFrame) {
      selectFrame(closestIdx);
    }
  };

  const formattedTime = `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  const progressPct = Math.max(0, Math.min(100, (timelineProgress / TIMELINE_MAX) * 100));

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-strong bg-ink-900/95 px-2 py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      {/* Transport */}
      <div className="flex items-center gap-0.5">
        <IconButton
          onClick={() => {
            if (selectFrame && currentFrameIndex > 0) {
              selectFrame(currentFrameIndex - 1);
            }
          }}
          disabled={currentFrameIndex <= 0}
          title={t("playback.previous")}
          aria-label={t("playback.previous")}
        >
          <SkipBack className="h-3.5 w-3.5" />
        </IconButton>

        <button
          type="button"
          onClick={handlePlayToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-fg text-ink transition-colors hover:bg-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal-green"
          title={isPlaying ? t("playback.pause") : t("playback.play")}
          aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
          )}
        </button>

        <IconButton
          onClick={() => {
            if (selectFrame && currentFrameIndex < frames.length - 1) {
              selectFrame(currentFrameIndex + 1);
            }
          }}
          disabled={currentFrameIndex >= frames.length - 1}
          title={t("playback.next")}
          aria-label={t("playback.next")}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {/* Clock */}
      <span className="min-w-[52px] font-display text-xl font-bold leading-none tabular-nums text-fg">
        {formattedTime}
      </span>

      {/* Match moment selector */}
      <label className="relative flex h-8 min-w-0 max-w-[300px] items-center rounded-md border border-line bg-ink-800 pl-2.5 pr-7 transition-colors hover:border-line-strong">
        <span className="sr-only">{t("playback.moment")}</span>
        <select
          value={currentFrameIndex}
          onChange={(e) => {
            const idx = Number(e.target.value);
            if (selectFrame) {
              selectFrame(idx);
            }
          }}
          className="w-full cursor-pointer appearance-none truncate bg-transparent text-[13px] text-fg outline-none"
        >
          {frames.map((f, i) => (
            <option key={f.event_uuid || i} value={i} className="bg-ink-900 text-fg">
              {formatMomentLabel(f)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-fg-subtle" />
      </label>

      {/* Timeline scrubber 0'-125' */}
      <div className="flex min-w-[180px] flex-1 items-center gap-2">
        <span className="font-mono text-[10px] tabular-nums text-fg-subtle">0'</span>
        <div className="relative flex-1 pb-3">
          {TIMELINE_MARKS.map((m) => (
            <div
              key={m.minute}
              className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${(m.minute / TIMELINE_MAX) * 100}%` }}
            >
              <span className="mt-[5px] h-1.5 w-px bg-fg-subtle" />
              <span className="mt-1 font-mono text-[9px] leading-none text-fg-subtle">{m.label}</span>
            </div>
          ))}
          <input
            type="range"
            min="0"
            max={TIMELINE_MAX}
            step="0.1"
            value={timelineProgress}
            onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
            aria-label={t("playback.timeline")}
            className="pl-range relative z-10 block"
            style={{ "--pct": `${progressPct}%` } as React.CSSProperties}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-fg-subtle">125'</span>
      </div>

      {/* Speed */}
      <div className="flex h-8 items-center rounded-md border border-line bg-ink-800 p-0.5" role="group" aria-label={t("playback.speed")}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSpeedSelect(s)}
            className={`h-full rounded-[4px] px-2 font-mono text-[11px] tabular-nums transition-colors ${
              speed === s ? "bg-white/[0.1] text-fg" : "text-fg-subtle hover:text-fg"
            }`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* Reset to reality */}
      <Button
        variant={isCounterfactualMode ? "secondary" : "ghost"}
        onClick={onResetSimulation}
        title={t("playback.resetTitle")}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{t("playback.reset")}</span>
      </Button>
    </div>
  );
};

export default PlaybackBar;
