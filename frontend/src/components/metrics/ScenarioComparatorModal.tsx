"use strict";
"use client";

import React, { useState } from "react";
import { MatchFramePayload, PlayerNode } from "@/types/match";
import { Pin, RotateCcw } from "lucide-react";
import { Button, Kicker, ModalShell, Tag } from "@/components/ui/primitives";
import { PALETTE, hair } from "@/lib/palette";
import { useI18n } from "@/lib/i18n";

export interface SavedScenario {
  id: string;
  label: string;
  timestamp: string;
  frame: MatchFramePayload;
}

export interface ScenarioComparatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFrame: MatchFramePayload;
  onRestoreScenario: (frame: MatchFramePayload) => void;
}

function calculateTotalDisplacement(players: PlayerNode[]): number {
  let total = 0;
  for (const p of players) {
    if (p.is_modified && p.original_x != null && p.original_y != null) {
      total += Math.hypot(p.x - p.original_x, p.y - p.original_y);
    }
  }
  return Math.round(total * 10) / 10;
}

function MiniPitchPreview({ frame }: { frame: MatchFramePayload }) {
  return (
    <div className="aspect-[120/80] w-full overflow-hidden rounded-[3px] border border-line bg-turf">
      <svg viewBox="0 0 120 80" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <g stroke={PALETTE.pitchLine} fill="none">
          <rect x="0" y="0" width="120" height="80" {...hair()} />
          <line x1="60" y1="0" x2="60" y2="80" {...hair()} />
          <circle cx="60" cy="40" r="9.15" {...hair()} />
          <rect x="0" y="19.85" width="16.5" height="40.3" {...hair()} />
          <rect x="103.5" y="19.85" width="16.5" height="40.3" {...hair()} />
        </g>

        {frame.players.map((p) => (
          <circle
            key={p.player_id}
            cx={p.x}
            cy={p.y}
            r={p.is_modified ? 2.2 : 1.6}
            fill={p.team === "home" ? PALETTE.home : PALETTE.away}
            stroke={p.is_modified ? PALETTE.fg : PALETTE.ink}
            strokeDasharray={p.is_modified ? "2 1.5" : undefined}
            {...hair(p.is_modified ? 1 : 0.5)}
          />
        ))}

        <circle cx={frame.ball_x} cy={frame.ball_y} r="1.1" fill={PALETTE.fg} stroke={PALETTE.ink} {...hair()} />
      </svg>
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between border-b border-line py-1.5 last:border-b-0">
    <span className="text-[12px] text-fg-muted">{label}</span>
    <span className="font-mono text-[12px] tabular-nums text-fg">{children}</span>
  </div>
);

const deltaClass = (delta: number) => (delta >= 0 ? "text-signal-gain" : "text-signal-loss");
const signed = (n: number, digits = 3) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export const ScenarioComparatorModal: React.FC<ScenarioComparatorModalProps> = ({
  isOpen,
  onClose,
  currentFrame,
  onRestoreScenario,
}) => {
  const { t } = useI18n();
  const [scenarioA, setScenarioA] = useState<SavedScenario | null>(null);
  const [scenarioB, setScenarioB] = useState<SavedScenario | null>(null);

  if (!isOpen) return null;

  const handlePinScenarioA = () => {
    setScenarioA({
      id: "scenario-a",
      label: "A",
      timestamp: new Date().toLocaleTimeString(),
      frame: JSON.parse(JSON.stringify(currentFrame)),
    });
  };

  const handlePinScenarioB = () => {
    setScenarioB({
      id: "scenario-b",
      label: "B",
      timestamp: new Date().toLocaleTimeString(),
      frame: JSON.parse(JSON.stringify(currentFrame)),
    });
  };

  // Evaluation of trade-off: delta reduction in threat per meter of displacement
  const getEfficiencyRatio = (sc: SavedScenario | null) => {
    if (!sc) return 0;
    const disp = calculateTotalDisplacement(sc.frame.players);
    const reduction = sc.frame.metrics.original_xt - sc.frame.metrics.simulated_xt;
    if (disp <= 0.05) return 0;
    return Math.round((reduction / disp) * 1000) / 1000;
  };

  const effA = getEfficiencyRatio(scenarioA);
  const effB = getEfficiencyRatio(scenarioB);

  let verdict = t("compare.pinBoth");
  let winner: "A" | "B" | null = null;
  if (scenarioA && scenarioB) {
    if (effA !== effB) {
      winner = effA > effB ? "A" : "B";
      const ratio = Math.max(effA, effB);
      verdict = t("compare.winner", { key: winner, ratio: `${ratio > 0 ? "+" : ""}${ratio}` });
    } else {
      verdict = t("compare.tie");
    }
  }

  const renderScenario = (key: "A" | "B", sc: SavedScenario | null) => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-fg font-display text-sm font-extrabold text-ink">
            {key}
          </span>
          <Kicker className="text-fg">{t("compare.scenario", { key })}</Kicker>
        </div>
        {sc && winner === key && <Tag tone="green">{t("compare.moreEfficient")}</Tag>}
        {sc && winner !== key && <span className="font-mono text-[10px] text-fg-subtle">{sc.timestamp}</span>}
      </div>

      {sc ? (
        <>
          <MiniPitchPreview frame={sc.frame} />
          <div>
            <Row label={t("compare.threat")}>
              {sc.frame.metrics.simulated_xt.toFixed(3)}{" "}
              <span className={deltaClass(sc.frame.metrics.xt_delta)}>({signed(sc.frame.metrics.xt_delta)})</span>
            </Row>
            <Row label={t("compare.control")}>{sc.frame.metrics.space_control_home_pct.toFixed(1)}%</Row>
            <Row label={t("compare.passSuccess")}>{sc.frame.metrics.pass_completion_prob.toFixed(1)}%</Row>
            <Row label={t("compare.totalDisplacement")}>{calculateTotalDisplacement(sc.frame.players)} m</Row>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onRestoreScenario(sc.frame);
              onClose();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("compare.restore")}
          </Button>
        </>
      ) : (
        <div className="flex aspect-[120/80] w-full flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed border-line-strong px-4 text-center text-[12px] text-fg-subtle">
          <Pin className="h-4 w-4" />
          {t("compare.empty", { key })}
        </div>
      )}
    </div>
  );

  return (
    <ModalShell
      kicker={t("compare.kicker")}
      title={t("compare.title")}
      description={t("compare.desc")}
      onClose={onClose}
      className="max-w-5xl"
      footer={
        <div className="flex w-full items-start gap-4">
          <Kicker className="shrink-0 pt-0.5">{t("compare.verdict")}</Kicker>
          <p className="text-[13px] text-fg">{verdict}</p>
        </div>
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12px] text-fg-muted">
          {t("compare.onBoard", { n: currentFrame.players.filter((p) => p.is_modified).length })}
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={handlePinScenarioA}>
            <Pin className="h-3.5 w-3.5" />
            {t("compare.pin", { key: "A" })}
          </Button>
          <Button size="sm" variant="secondary" onClick={handlePinScenarioB}>
            <Pin className="h-3.5 w-3.5" />
            {t("compare.pin", { key: "B" })}
          </Button>
        </div>
      </div>

      {/* Base vs A vs B */}
      <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <Kicker className="text-fg">{t("compare.original")}</Kicker>
            <span className="font-mono text-[10px] text-fg-subtle">{t("compare.unchanged")}</span>
          </div>
          <MiniPitchPreview frame={currentFrame} />
          <div>
            <Row label={t("compare.baseThreat")}>{currentFrame.metrics.original_xt.toFixed(3)}</Row>
            <Row label={t("compare.control")}>{currentFrame.metrics.space_control_home_pct.toFixed(1)}%</Row>
            <Row label={t("compare.passSuccess")}>{currentFrame.metrics.pass_completion_prob.toFixed(1)}%</Row>
            <Row label={t("compare.displacement")}>0.0 m</Row>
          </div>
        </div>
        {renderScenario("A", scenarioA)}
        {renderScenario("B", scenarioB)}
      </div>
    </ModalShell>
  );
};
