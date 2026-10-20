"use strict";
"use client";

import React, { useState } from "react";
import { MatchFramePayload, PlayerNode } from "@/types/match";
import { Pin, RotateCcw } from "lucide-react";
import { Button, Kicker, ModalShell, Tag } from "@/components/ui/primitives";
import { PALETTE, hair } from "@/lib/palette";

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

const deltaClass = (delta: number) => (delta >= 0 ? "text-signal-green" : "text-signal-magenta");
const signed = (n: number, digits = 3) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export const ScenarioComparatorModal: React.FC<ScenarioComparatorModalProps> = ({
  isOpen,
  onClose,
  currentFrame,
  onRestoreScenario,
}) => {
  const [scenarioA, setScenarioA] = useState<SavedScenario | null>(null);
  const [scenarioB, setScenarioB] = useState<SavedScenario | null>(null);

  if (!isOpen) return null;

  const handlePinScenarioA = () => {
    setScenarioA({
      id: "scenario-a",
      label: "Escenario A",
      timestamp: new Date().toLocaleTimeString(),
      frame: JSON.parse(JSON.stringify(currentFrame)),
    });
  };

  const handlePinScenarioB = () => {
    setScenarioB({
      id: "scenario-b",
      label: "Escenario B",
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

  let verdict = "Fija ambos escenarios para comparar su eficiencia táctica.";
  let winner: "A" | "B" | null = null;
  if (scenarioA && scenarioB) {
    if (effA > effB) {
      winner = "A";
      verdict = `El escenario A es más eficiente (${effA > 0 ? "+" : ""}${effA} ΔxT/m): reduce más peligro con menos desgaste físico.`;
    } else if (effB > effA) {
      winner = "B";
      verdict = `El escenario B es más eficiente (${effB > 0 ? "+" : ""}${effB} ΔxT/m): mejor cierre del carril interior por metro recorrido.`;
    } else {
      verdict = "Ambos escenarios tienen el mismo perfil de riesgo/recompensa.";
    }
  }

  const renderScenario = (key: "A" | "B", sc: SavedScenario | null) => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-fg font-display text-sm font-extrabold text-ink">
            {key}
          </span>
          <Kicker className="text-fg">Escenario {key}</Kicker>
        </div>
        {sc && winner === key && <Tag tone="green">Más eficiente</Tag>}
        {sc && winner !== key && <span className="font-mono text-[10px] text-fg-subtle">{sc.timestamp}</span>}
      </div>

      {sc ? (
        <>
          <MiniPitchPreview frame={sc.frame} />
          <div>
            <Row label="Amenaza (xT)">
              {sc.frame.metrics.simulated_xt.toFixed(3)}{" "}
              <span className={deltaClass(sc.frame.metrics.xt_delta)}>({signed(sc.frame.metrics.xt_delta)})</span>
            </Row>
            <Row label="Control Voronoi">{sc.frame.metrics.space_control_home_pct.toFixed(1)}%</Row>
            <Row label="Éxito de pase">{sc.frame.metrics.pass_completion_prob.toFixed(1)}%</Row>
            <Row label="Desplazamiento total">{calculateTotalDisplacement(sc.frame.players)} m</Row>
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
            Restaurar en la pizarra
          </Button>
        </>
      ) : (
        <div className="flex aspect-[120/80] w-full flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed border-line-strong px-4 text-center text-[12px] text-fg-subtle">
          <Pin className="h-4 w-4" />
          Mueve jugadores y pulsa «Fijar {key}».
        </div>
      )}
    </div>
  );

  return (
    <ModalShell
      kicker="Comparador"
      title="Escenario A vs B"
      description="Guarda dos hipótesis y compara la reducción de peligro frente al esfuerzo físico."
      onClose={onClose}
      className="max-w-5xl"
      footer={
        <div className="flex w-full items-start gap-4">
          <Kicker className="shrink-0 pt-0.5">Veredicto</Kicker>
          <p className="text-[13px] text-fg">{verdict}</p>
        </div>
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12px] text-fg-muted">
          En la pizarra:{" "}
          <span className="font-mono text-fg">{currentFrame.players.filter((p) => p.is_modified).length}</span> jugadores
          modificados
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={handlePinScenarioA}>
            <Pin className="h-3.5 w-3.5" />
            Fijar A
          </Button>
          <Button size="sm" variant="secondary" onClick={handlePinScenarioB}>
            <Pin className="h-3.5 w-3.5" />
            Fijar B
          </Button>
        </div>
      </div>

      {/* Base vs A vs B */}
      <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <Kicker className="text-fg">Realidad</Kicker>
            <span className="font-mono text-[10px] text-fg-subtle">StatsBomb 360</span>
          </div>
          <MiniPitchPreview frame={currentFrame} />
          <div>
            <Row label="Amenaza base (xT)">{currentFrame.metrics.original_xt.toFixed(3)}</Row>
            <Row label="Control Voronoi">{currentFrame.metrics.space_control_home_pct.toFixed(1)}%</Row>
            <Row label="Éxito de pase">{currentFrame.metrics.pass_completion_prob.toFixed(1)}%</Row>
            <Row label="Desplazamiento">0.0 m</Row>
          </div>
        </div>
        {renderScenario("A", scenarioA)}
        {renderScenario("B", scenarioB)}
      </div>
    </ModalShell>
  );
};
