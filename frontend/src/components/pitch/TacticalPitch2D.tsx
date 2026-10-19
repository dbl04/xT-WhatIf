"use strict";
"use client";

import React, { useState, useRef, useCallback, useMemo } from "react";
import { PlayerNode, TacticalMetrics } from "@/types/match";
import {
  STATSBOMB_PITCH_LENGTH,
  STATSBOMB_PITCH_WIDTH,
  screenToStatsbomb,
  calculateDistanceMeters,
  getTacticalZoneName,
} from "@/lib/coordinates";
import {
  Move,
  Grid,
  Ghost,
  Eye,
  Crosshair,
  Sparkles,
} from "lucide-react";

interface TacticalPitch2DProps {
  players: PlayerNode[];
  ballX: number;
  ballY: number;
  ballEndX?: number | null;
  ballEndY?: number | null;
  metrics?: TacticalMetrics;
  isCounterfactualMode?: boolean;
  highlightedPlayerIds?: number[];
  selectedPlayerId?: number | null;
  onHoverPlayer?: (playerId: number | null) => void;
  onClickPlayer?: (playerId: number) => void;
  onPlayerMove?: (playerId: number, newX: number, newY: number) => void;
  onSimulationTrigger?: (playerId: number) => void;
}

// 192 celdas canónicas de Expected Threat (16 columnas x 12 filas)
const XT_GRID_COLS = 16;
const XT_GRID_ROWS = 12;
const CELL_W = STATSBOMB_PITCH_LENGTH / XT_GRID_COLS; // 7.5m
const CELL_H = STATSBOMB_PITCH_WIDTH / XT_GRID_ROWS; // 6.6667m

// Generador de matriz de peligro esperado xT estilizada y canónica
function computeCellXt(col: number, row: number): number {
  // Progresión hacia portería rival (X: col 0 -> 15)
  const xProgress = col / (XT_GRID_COLS - 1);
  // Centralidad (Y: fila 0 a 11, centro en 5.5)
  const yDist = Math.abs(row - 5.5) / 5.5;
  const centralFactor = 1 - yDist * 0.45;

  let val = Math.pow(xProgress, 2.2) * 0.48 * centralFactor + 0.015;
  // Boost específico para Zona 14 y área rival
  if (col >= 11 && row >= 3 && row <= 8) {
    val += 0.08;
  }
  return Number(Math.min(0.65, Math.max(0.01, val)).toFixed(3));
}

export const TacticalPitch2D: React.FC<TacticalPitch2DProps> = ({
  players,
  ballX,
  ballY,
  ballEndX,
  ballEndY,
  metrics,
  isCounterfactualMode = false,
  highlightedPlayerIds = [],
  selectedPlayerId = null,
  onHoverPlayer,
  onClickPlayer,
  onPlayerMove,
  onSimulationTrigger,
}) => {
  // Estados de Toggles Visuales (Entregable 2)
  const [showXtGrid, setShowXtGrid] = useState<boolean>(true);
  const [showPassCorridor, setShowPassCorridor] = useState<boolean>(true);
  const [showGhostMode, setShowGhostMode] = useState<boolean>(true);

  // Estados interactivos
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [hoveredCellXt, setHoveredCellXt] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Matriz de 192 celdas memorizada
  const xtGridCells = useMemo(() => {
    const cells = [];
    for (let col = 0; col < XT_GRID_COLS; col++) {
      for (let row = 0; row < XT_GRID_ROWS; row++) {
        const x = col * CELL_W;
        const y = row * CELL_H;
        const xtVal = computeCellXt(col, row);
        cells.push({ col, row, x, y, xtVal });
      }
    }
    return cells;
  }, []);

  // Coordenadas de celda origen y destino del pase
  const originCell = useMemo(() => {
    const col = Math.min(XT_GRID_COLS - 1, Math.max(0, Math.floor(ballX / CELL_W)));
    const row = Math.min(XT_GRID_ROWS - 1, Math.max(0, Math.floor(ballY / CELL_H)));
    return { col, row };
  }, [ballX, ballY]);

  const destCell = useMemo(() => {
    if (ballEndX == null || ballEndY == null) return null;
    const col = Math.min(XT_GRID_COLS - 1, Math.max(0, Math.floor(ballEndX / CELL_W)));
    const row = Math.min(XT_GRID_ROWS - 1, Math.max(0, Math.floor(ballEndY / CELL_H)));
    return { col, row };
  }, [ballEndX, ballEndY]);

  // Manejador de puntero para Drag & Drop estricto
  const handlePointerDown = (id: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setDraggingId(id);
    if (onClickPlayer) {
      onClickPlayer(id);
    }
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingId === null || !svgRef.current || !onPlayerMove) return;

      const rect = svgRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const { x, y } = screenToStatsbomb(clientX, clientY, rect.width, rect.height);
      setHoveredZone(getTacticalZoneName(x, y));
      onPlayerMove(draggingId, x, y);
    },
    [draggingId, onPlayerMove]
  );

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId !== null) {
      const droppedId = draggingId;
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      setDraggingId(null);
      setHoveredZone(null);
      if (onSimulationTrigger) {
        onSimulationTrigger(droppedId);
      }
    }
  };

  // Cálculo del polígono de cono / corredor de pase (Toggle 2)
  const passCorridorPolygon = useMemo(() => {
    if (ballEndX == null || ballEndY == null) return null;
    const dx = ballEndX - ballX;
    const dy = ballEndY - ballY;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    // Vector perpendicular normalizado
    const perpX = -uy;
    const perpY = ux;

    const wStart = 1.6;
    const wEnd = 4.4;

    const p1x = ballX + perpX * wStart;
    const p1y = ballY + perpY * wStart;
    const p2x = ballEndX + perpX * wEnd;
    const p2y = ballEndY + perpY * wEnd;
    const p3x = ballEndX - perpX * wEnd;
    const p3y = ballEndY - perpY * wEnd;
    const p4x = ballX - perpX * wStart;
    const p4y = ballY - perpY * wStart;

    return `${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)} ${p3x.toFixed(2)},${p3y.toFixed(2)} ${p4x.toFixed(2)},${p4y.toFixed(2)}`;
  }, [ballX, ballY, ballEndX, ballEndY]);

  // Jugador poseedor y alternativa óptima (Opción B IA)
  const actorPlayer = players.find((p) => p.is_actor) || players[0];
  const optimalTargetPlayer = useMemo(() => {
    if (!metrics?.optimal_pass_target_id) return null;
    return players.find((p) => p.player_id === metrics.optimal_pass_target_id) || null;
  }, [players, metrics?.optimal_pass_target_id]);

  return (
    <div className="relative w-full flex flex-col bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden select-none">
      {/* Top Bar - Header y Barra Flotante de Toggles Visuales */}
      <div className="flex flex-wrap items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md gap-3">
        {/* Identificador Canónico */}
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-500/50" />
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-100">
              Pizarra Táctica StatsBomb 360
            </span>
            <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50">
              120.0m × 80.0m
            </span>
          </div>
        </div>

        {/* ============================================================== */}
        {/* BARRA FLOTANTE DE TOGGLES VISUALES (ENTREGABLE 2)              */}
        {/* ============================================================== */}
        <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          {/* Toggle 1: Grilla xT (16x12) */}
          <button
            onClick={() => setShowXtGrid(!showXtGrid)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
              showXtGrid
                ? "bg-emerald-950 text-emerald-300 border border-emerald-600/70 shadow-sm shadow-emerald-950/60"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
            title="Activa/desactiva la matriz de 192 celdas de Expected Threat"
          >
            <Grid className={`w-3.5 h-3.5 ${showXtGrid ? "text-emerald-400" : "text-slate-500"}`} />
            <span>Grilla xT (16x12)</span>
          </button>

          {/* Toggle 2: Sombra de Pase & Alternativa Óptima */}
          <button
            onClick={() => setShowPassCorridor(!showPassCorridor)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
              showPassCorridor
                ? "bg-cyan-950 text-cyan-300 border border-cyan-600/70 shadow-sm shadow-cyan-950/60"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
            title="Muestra el corredor de pase y la segunda línea recomendada por IA"
          >
            <Eye className={`w-3.5 h-3.5 ${showPassCorridor ? "text-cyan-400" : "text-slate-500"}`} />
            <span>Sombra & Pase Óptimo</span>
          </button>

          {/* Toggle 3: Vectores Fantasma (Ghost Mode) */}
          <button
            onClick={() => setShowGhostMode(!showGhostMode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
              showGhostMode
                ? "bg-pink-950 text-pink-300 border border-pink-600/70 shadow-sm shadow-pink-950/60"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
            title="Muestra/oculta los vectores de desplazamiento contrafactual"
          >
            <Ghost className={`w-3.5 h-3.5 ${showGhostMode ? "text-pink-400" : "text-slate-500"}`} />
            <span>Vectores Fantasma</span>
          </button>
        </div>
      </div>

      {/* Canvas SVG Container */}
      <div className="relative w-full aspect-[120/80] bg-[#07130c] p-2 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${STATSBOMB_PITCH_LENGTH} ${STATSBOMB_PITCH_WIDTH}`}
          className="w-full h-full rounded-xl shadow-inner border border-emerald-950/80"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: "none" }}
        >
          <defs>
            {/* Patrón de césped oscuro profesional */}
            <pattern id="pitchGrassStripes" width="15" height="80" patternUnits="userSpaceOnUse">
              <rect width="7.5" height="80" fill="#08170e" />
              <rect x="7.5" width="7.5" height="80" fill="#06120b" />
            </pattern>

            {/* Gradiente para cono/corredor de visión de pase */}
            <linearGradient id="passVisionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.32" />
            </linearGradient>

            {/* Gradientes para celdas xT */}
            <radialGradient id="xtOriginGlow">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
            </radialGradient>
            <radialGradient id="xtDestGlow">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
            </radialGradient>

            {/* Marcadores de flechas */}
            <marker
              id="ghostArrowHead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
            </marker>

            <marker
              id="ballArrowHead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4.5"
              markerHeight="4.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
            </marker>

            <marker
              id="optimalArrowHead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4.5"
              markerHeight="4.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#22d3ee" />
            </marker>

            {/* Filtros Glow */}
            <filter id="haloMoved" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#f43f5e" floodOpacity="0.9" />
            </filter>
            <filter id="haloActor" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.3" floodColor="#fbbf24" floodOpacity="0.9" />
            </filter>
            <filter id="haloHighlight" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#38bdf8" floodOpacity="1" />
            </filter>
            <filter id="haloOptimal" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.6" floodColor="#22d3ee" floodOpacity="0.95" />
            </filter>
          </defs>

          {/* Fondo de césped */}
          <rect width="120" height="80" fill="url(#pitchGrassStripes)" />

          {/* ============================================================== */}
          {/* TOGGLE 1: GRILLA xT (16x12) - 192 CELDAS                       */}
          {/* ============================================================== */}
          {showXtGrid && (
            <g id="xtGridLayer" pointerEvents="all">
              {xtGridCells.map((cell) => {
                const isOrigin = cell.col === originCell.col && cell.row === originCell.row;
                const isDest = destCell && cell.col === destCell.col && cell.row === destCell.row;

                // Color dinámico según amenaza esperada
                let cellFill = "rgba(16, 185, 129, 0.04)";
                if (cell.xtVal > 0.32) {
                  cellFill = `rgba(244, 63, 94, ${Math.min(0.32, cell.xtVal * 0.55)})`;
                } else if (cell.xtVal > 0.18) {
                  cellFill = `rgba(245, 158, 11, ${Math.min(0.24, cell.xtVal * 0.5)})`;
                } else if (cell.xtVal > 0.08) {
                  cellFill = `rgba(6, 182, 212, ${Math.min(0.18, cell.xtVal * 0.5)})`;
                }

                return (
                  <g
                    key={`xt-cell-${cell.col}-${cell.row}`}
                    onMouseEnter={() => setHoveredCellXt(cell.xtVal)}
                    onMouseLeave={() => setHoveredCellXt(null)}
                    className="transition-colors cursor-crosshair"
                  >
                    <rect
                      x={cell.x}
                      y={cell.y}
                      width={CELL_W}
                      height={CELL_H}
                      fill={isOrigin ? "url(#xtOriginGlow)" : isDest ? "url(#xtDestGlow)" : cellFill}
                      stroke={
                        isOrigin
                          ? "#10b981"
                          : isDest
                          ? "#22d3ee"
                          : "rgba(255, 255, 255, 0.05)"
                      }
                      strokeWidth={isOrigin || isDest ? "0.75" : "0.15"}
                      strokeDasharray={isOrigin || isDest ? "1.5 0.8" : "none"}
                    />

                    {/* Resaltado especial para celda de origen */}
                    {isOrigin && (
                      <g transform={`translate(${cell.x + CELL_W / 2}, ${cell.y + CELL_H / 2})`}>
                        <text
                          y="0.7"
                          fontSize="1.7"
                          fontWeight="bold"
                          fontFamily="monospace"
                          fill="#34d399"
                          textAnchor="middle"
                          pointerEvents="none"
                        >
                          ORIGEN
                        </text>
                      </g>
                    )}

                    {/* Resaltado especial para celda de destino */}
                    {isDest && (
                      <g transform={`translate(${cell.x + CELL_W / 2}, ${cell.y + CELL_H / 2})`}>
                        <text
                          y="0.7"
                          fontSize="1.7"
                          fontWeight="bold"
                          fontFamily="monospace"
                          fill="#38bdf8"
                          textAnchor="middle"
                          pointerEvents="none"
                        >
                          DESTINO
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Marcado de Cancha Oficial StatsBomb (120 x 80) */}
          <g stroke="rgba(255, 255, 255, 0.22)" strokeWidth="0.38" fill="none" pointerEvents="none">
            {/* Perímetro */}
            <rect x="0" y="0" width="120" height="80" />
            {/* Línea media */}
            <line x1="60" y1="0" x2="60" y2="80" />
            {/* Círculo central (R = 9.15) */}
            <circle cx="60" cy="40" r="9.15" />
            <circle cx="60" cy="40" r="0.6" fill="rgba(255, 255, 255, 0.45)" stroke="none" />

            {/* Área Grande Izquierda */}
            <rect x="0" y="19.85" width="16.5" height="40.3" />
            {/* Área Chica Izquierda */}
            <rect x="0" y="30.85" width="5.5" height="18.3" />
            {/* Punto penal izq */}
            <circle cx="11" cy="40" r="0.6" fill="rgba(255, 255, 255, 0.45)" stroke="none" />
            <path d="M 16.5 32.7 A 9.15 9.15 0 0 1 16.5 47.3" />

            {/* Área Grande Derecha */}
            <rect x="103.5" y="19.85" width="16.5" height="40.3" />
            {/* Área Chica Derecha */}
            <rect x="114.5" y="30.85" width="5.5" height="18.3" />
            {/* Punto penal der */}
            <circle cx="109" cy="40" r="0.6" fill="rgba(255, 255, 255, 0.45)" stroke="none" />
            <path d="M 103.5 32.7 A 9.15 9.15 0 0 0 103.5 47.3" />

            {/* Córners */}
            <path d="M 0 1 A 1 1 0 0 0 1 0" />
            <path d="M 0 79 A 1 1 0 0 1 1 80" />
            <path d="M 120 1 A 1 1 0 0 1 119 0" />
            <path d="M 120 79 A 1 1 0 0 0 119 80" />
          </g>

          {/* ============================================================== */}
          {/* TOGGLE 2: SOMBRA DE PASE & ALTERNATIVA ÓPTIMA                  */}
          {/* ============================================================== */}
          {showPassCorridor && (
            <g id="passCorridorLayer" pointerEvents="none">
              {/* 1. Cono / Corredor de visión de pase */}
              {passCorridorPolygon && (
                <polygon
                  points={passCorridorPolygon}
                  fill="url(#passVisionGradient)"
                  stroke="rgba(251, 191, 36, 0.4)"
                  strokeWidth="0.35"
                  strokeDasharray="1.2 1"
                />
              )}

              {/* Vector de trayectoria real del balón */}
              {ballEndX != null && ballEndY != null && (
                <g>
                  <line
                    x1={ballX}
                    y1={ballY}
                    x2={ballEndX}
                    y2={ballEndY}
                    stroke="#fbbf24"
                    strokeWidth="0.8"
                    strokeDasharray="2 1.2"
                    markerEnd="url(#ballArrowHead)"
                  />
                  <circle
                    cx={ballEndX}
                    cy={ballEndY}
                    r="1.2"
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="0.4"
                    strokeDasharray="0.8 0.8"
                  />
                </g>
              )}

              {/* 2. Segunda línea de pase recomendada (OPCIÓN B ÓPTIMA IA) */}
              {isCounterfactualMode && optimalTargetPlayer && (
                <g id="optimalPassLine">
                  <line
                    x1={actorPlayer ? actorPlayer.x : ballX}
                    y1={actorPlayer ? actorPlayer.y : ballY}
                    x2={optimalTargetPlayer.x}
                    y2={optimalTargetPlayer.y}
                    stroke="#22d3ee"
                    strokeWidth="0.9"
                    strokeDasharray="2 1.2"
                    markerEnd="url(#optimalArrowHead)"
                    filter="url(#haloOptimal)"
                  />

                  {/* Etiqueta Flotante OPCIÓN B ÓPTIMA (IA) */}
                  {(() => {
                    const startX = actorPlayer ? actorPlayer.x : ballX;
                    const startY = actorPlayer ? actorPlayer.y : ballY;
                    const midX = (startX + optimalTargetPlayer.x) / 2;
                    const midY = (startY + optimalTargetPlayer.y) / 2;

                    return (
                      <g transform={`translate(${midX}, ${midY - 2.8})`}>
                        <rect
                          x="-14"
                          y="-2.2"
                          width="28"
                          height="4.4"
                          rx="1.2"
                          fill="#082f49"
                          stroke="#22d3ee"
                          strokeWidth="0.45"
                          opacity="0.96"
                        />
                        <text
                          x="0"
                          y="0.8"
                          fontSize="2.0"
                          fontWeight="bold"
                          fontFamily="monospace"
                          fill="#38bdf8"
                          textAnchor="middle"
                        >
                          OPCIÓN B ÓPTIMA (IA)
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}
            </g>
          )}

          {/* ============================================================== */}
          {/* TOGGLE 3: VECTORES FANTASMA (GHOST MODE)                        */}
          {/* ============================================================== */}
          {showGhostMode &&
            players
              .filter((p) => p.is_modified && p.original_x != null && p.original_y != null)
              .map((p) => {
                const origX = p.original_x!;
                const origY = p.original_y!;
                const distanceMeters = calculateDistanceMeters(
                  { x: origX, y: origY },
                  { x: p.x, y: p.y }
                );
                const midX = (origX + p.x) / 2;
                const midY = (origY + p.y) / 2;

                return (
                  <g key={`ghost-vector-${p.player_id}`} pointerEvents="none">
                    {/* Flecha Vectorial Punteada */}
                    <line
                      x1={origX}
                      y1={origY}
                      x2={p.x}
                      y2={p.y}
                      stroke="#f43f5e"
                      strokeWidth="0.75"
                      strokeDasharray="1.2 1"
                      markerEnd="url(#ghostArrowHead)"
                      opacity="0.95"
                    />

                    {/* Chip Métrico de Desplazamiento +X.Xm */}
                    {distanceMeters > 0.4 && (
                      <g transform={`translate(${midX}, ${midY})`}>
                        <rect
                          x="-4.5"
                          y="-2.0"
                          width="9"
                          height="4"
                          rx="1"
                          fill="#020617"
                          stroke="#f43f5e"
                          strokeWidth="0.35"
                          opacity="0.95"
                        />
                        <text
                          x="0"
                          y="0.8"
                          fontSize="2.1"
                          fontWeight="bold"
                          fontFamily="monospace"
                          fill="#fda4af"
                          textAnchor="middle"
                        >
                          +{distanceMeters}m
                        </text>
                      </g>
                    )}

                    {/* Nodo Original Semitransparente al 35% de opacidad */}
                    <g opacity="0.35">
                      <circle
                        cx={origX}
                        cy={origY}
                        r="2.6"
                        fill={p.team === "home" ? "#2563eb" : "#dc2626"}
                        stroke="#ffffff"
                        strokeWidth="0.6"
                        strokeDasharray="0.8 0.8"
                      />
                      <text
                        x={origX}
                        y={origY + 0.9}
                        fontSize="2.3"
                        fontWeight="bold"
                        fill="#ffffff"
                        textAnchor="middle"
                      >
                        {p.jersey_number}
                      </text>
                    </g>
                  </g>
                );
              })}

          {/* ============================================================== */}
          {/* JUGADORES SÓLIDOS INTERACTIVOS (DRAG & DROP + HOVER BIDIRECCIONAL)*/}
          {/* ============================================================== */}
          {players.map((p) => {
            const isHome = p.team === "home";
            const isDragging = draggingId === p.player_id;
            const isActor = p.is_actor;
            const isHighlighted = highlightedPlayerIds.includes(p.player_id);
            const isSelected = selectedPlayerId === p.player_id;

            return (
              <g
                key={p.player_id}
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={(e) => handlePointerDown(p.player_id, e)}
                onMouseEnter={() => onHoverPlayer && onHoverPlayer(p.player_id)}
                onMouseLeave={() => onHoverPlayer && onHoverPlayer(null)}
                className="cursor-grab active:cursor-grabbing transition-transform duration-75"
              >
                {/* Halo de jugador modificado contrafactual */}
                {p.is_modified && (
                  <circle
                    r="4.4"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="0.8"
                    className="animate-pulse"
                    filter="url(#haloMoved)"
                  />
                )}

                {/* Halo de Destacado / Iluminación Cruzada desde el Debate */}
                {isHighlighted && (
                  <circle
                    r="4.8"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="0.9"
                    className="animate-ping"
                    filter="url(#haloHighlight)"
                  />
                )}

                {/* Halo de Jugador Seleccionado */}
                {isSelected && (
                  <circle
                    r="5.2"
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="1.1"
                    strokeDasharray="1.5 1"
                  />
                )}

                {/* Halo de Actor (Poseedor del balón) */}
                {isActor && (
                  <circle
                    r="4.0"
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="0.65"
                    className="animate-pulse"
                    filter="url(#haloActor)"
                  />
                )}

                {/* Nodo Sólido del Jugador */}
                <circle
                  r={isDragging ? "3.2" : "2.6"}
                  fill={isHome ? "#1d4ed8" : "#be123c"}
                  stroke={
                    p.is_modified
                      ? "#fda4af"
                      : isHighlighted || isSelected
                      ? "#38bdf8"
                      : "#ffffff"
                  }
                  strokeWidth={p.is_modified || isHighlighted ? "0.9" : "0.5"}
                />

                {/* Número en Camiseta */}
                <text
                  y="0.9"
                  fontSize="2.4"
                  fontWeight="bold"
                  fill="#ffffff"
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {p.jersey_number}
                </text>

                {/* Etiqueta de Nombre del Jugador */}
                <text
                  y="5.0"
                  fontSize="2.2"
                  fontWeight="600"
                  fill="#f1f5f9"
                  textAnchor="middle"
                  pointerEvents="none"
                  className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                >
                  {p.name.split(" ").pop()}
                </text>
              </g>
            );
          })}

          {/* Balón */}
          <g transform={`translate(${ballX}, ${ballY})`} pointerEvents="none">
            <circle r="1.3" fill="#ffffff" stroke="#000000" strokeWidth="0.3" />
            <circle r="0.5" fill="#f59e0b" />
          </g>
        </svg>
      </div>

      {/* Footer Helper & Telemetría Rápida */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/60 border-t border-slate-800/80 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <Move className="w-3.5 h-3.5 text-amber-400" />
          <span>Arrastra a cualquier jugador para simular el escenario contrafactual.</span>
        </div>
        <div className="flex items-center gap-3">
          {hoveredCellXt != null && (
            <div className="font-mono text-[10px] text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
              Celda xT: {hoveredCellXt.toFixed(3)}
            </div>
          )}
          {hoveredZone && (
            <div className="font-mono text-[10px] text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">
              Zona: {hoveredZone}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TacticalPitch2D;
