"use strict";
"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { PlayerNode, TacticalMetrics } from "@/types/match";
import {
  STATSBOMB_PITCH_LENGTH,
  STATSBOMB_PITCH_WIDTH,
  screenToStatsbomb,
  calculateDistanceMeters,
  getTacticalZoneName,
} from "@/lib/coordinates";
import { Move, Grid, Ghost, Eye } from "lucide-react";
import { computeVoronoiCells } from "@/lib/voronoi";

// ======================================================================
// CONSTANTES DE ARQUITECTURA
// ======================================================================
const XT_GRID_COLS = 16;
const XT_GRID_ROWS = 12;
const CELL_W = STATSBOMB_PITCH_LENGTH / XT_GRID_COLS; // 7.5m
const CELL_H = STATSBOMB_PITCH_WIDTH / XT_GRID_ROWS; // 6.6667m

/** Radio de inercia física (sincronizado con tactical_math.py del backend) */
const INERTIA_RADIUS = 6.0;

/** Base animation duration in ms (adjusted by speed multiplier) */
const BASE_ANIM_DURATION_MS = 2000;

// ======================================================================
// INTERFACES
// ======================================================================
export interface TacticalPitch2DProps {
  players: PlayerNode[];
  ballX: number;
  ballY: number;
  ballEndX?: number | null;
  ballEndY?: number | null;
  metrics?: TacticalMetrics;
  isCounterfactualMode?: boolean;
  isPlaying?: boolean;
  playbackSpeed?: number;
  highlightedPlayerIds?: number[];
  selectedPlayerId?: number | null;
  onHoverPlayer?: (playerId: number | null) => void;
  onClickPlayer?: (playerId: number) => void;
  onPlayerMove?: (playerId: number, newX: number, newY: number) => void;
  onSimulationTrigger?: (playerId: number) => void;
  onAnimationEnd?: () => void;
  onDragStart?: () => void;
}

export interface TacticalPitch2DHandle {
  getSvgElement: () => SVGSVGElement | null;
}

// ======================================================================
// xT HEATMAP UTILITIES
// ======================================================================
function computeCellXt(col: number, row: number): number {
  const xProgress = col / (XT_GRID_COLS - 1);
  const yDist = Math.abs(row - 5.5) / 5.5;
  const centralFactor = 1 - yDist * 0.45;
  let val = Math.pow(xProgress, 2.2) * 0.48 * centralFactor + 0.015;
  if (col >= 11 && row >= 3 && row <= 8) val += 0.08;
  return Number(Math.min(0.65, Math.max(0.01, val)).toFixed(3));
}

// ======================================================================
// COMPONENT
// ======================================================================
export const TacticalPitch2D = forwardRef<TacticalPitch2DHandle, TacticalPitch2DProps>(
  function TacticalPitch2DInner(
    {
      players,
      ballX,
      ballY,
      ballEndX,
      ballEndY,
      metrics,
      isCounterfactualMode = false,
      isPlaying = false,
      playbackSpeed = 1,
      highlightedPlayerIds = [],
      selectedPlayerId = null,
      onHoverPlayer,
      onClickPlayer,
      onPlayerMove,
      onSimulationTrigger,
      onAnimationEnd,
      onDragStart,
    },
    ref
  ) {
    // Toggle states
    const [showVoronoi, setShowVoronoi] = useState<boolean>(true);
    const [showXtGrid, setShowXtGrid] = useState<boolean>(true);
    const [showPassCorridor, setShowPassCorridor] = useState<boolean>(true);
    const [showGhostMode, setShowGhostMode] = useState<boolean>(true);

    // Interaction states
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [hoveredCellXt, setHoveredCellXt] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);

    // ============================================================
    // ENTREGABLE 1: ANIMACIÓN CINEMÁTICA (requestAnimationFrame)
    // ============================================================
    const [animProgress, setAnimProgress] = useState<number>(0);
    const animFrameRef = useRef<number>(0);
    const animStartRef = useRef<number>(0);

    // Expose SVG ref for export
    useImperativeHandle(ref, () => ({
      getSvgElement: () => svgRef.current,
    }));

    useEffect(() => {
      if (!isPlaying) {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setAnimProgress(0);
        return;
      }

      const duration = BASE_ANIM_DURATION_MS / playbackSpeed;
      animStartRef.current = 0;

      const tick = (timestamp: number) => {
        if (!animStartRef.current) animStartRef.current = timestamp;
        const elapsed = timestamp - animStartRef.current;
        const t = Math.min(1, elapsed / duration);

        // Smooth ease-in-out
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        setAnimProgress(eased);

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          setAnimProgress(0);
          if (onAnimationEnd) onAnimationEnd();
        }
      };

      animFrameRef.current = requestAnimationFrame(tick);

      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }, [isPlaying, playbackSpeed, onAnimationEnd]);

    // Compute animated ball position
    const animBallX = useMemo(() => {
      if (!isPlaying || animProgress === 0 || ballEndX == null) return ballX;
      return ballX + (ballEndX - ballX) * animProgress;
    }, [isPlaying, animProgress, ballX, ballEndX]);

    const animBallY = useMemo(() => {
      if (!isPlaying || animProgress === 0 || ballEndY == null) return ballY;
      return ballY + (ballEndY - ballY) * animProgress;
    }, [isPlaying, animProgress, ballY, ballEndY]);

    // Compute animated player micro-runs (1.5m-3.5m toward ball_end for teammates, toward ball for defenders)
    const animatedPlayers = useMemo(() => {
      if (!isPlaying || animProgress === 0) return players;
      const bEndX = ballEndX ?? ballX;
      const bEndY = ballEndY ?? ballY;

      return players.map((p) => {
        if (p.is_keeper) return p; // GKs stay put
        const targetX = p.team === players.find((a) => a.is_actor)?.team ? bEndX : ballX;
        const targetY = p.team === players.find((a) => a.is_actor)?.team ? bEndY : ballY;
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        // Each player runs 1.5 to 3.5m based on how close they are to the action
        const runDist = Math.min(3.5, Math.max(1.5, dist * 0.08));
        const ux = dx / dist;
        const uy = dy / dist;
        return {
          ...p,
          x: Number((p.x + ux * runDist * animProgress).toFixed(1)),
          y: Number((p.y + uy * runDist * animProgress).toFixed(1)),
        };
      });
    }, [isPlaying, animProgress, players, ballX, ballY, ballEndX, ballEndY]);

    // xT Grid cells (memoized)
    const xtGridCells = useMemo(() => {
      const cells = [];
      for (let col = 0; col < XT_GRID_COLS; col++) {
        for (let row = 0; row < XT_GRID_ROWS; row++) {
          cells.push({ col, row, x: col * CELL_W, y: row * CELL_H, xtVal: computeCellXt(col, row) });
        }
      }
      return cells;
    }, []);

    const originCell = useMemo(() => ({
      col: Math.min(XT_GRID_COLS - 1, Math.max(0, Math.floor(ballX / CELL_W))),
      row: Math.min(XT_GRID_ROWS - 1, Math.max(0, Math.floor(ballY / CELL_H))),
    }), [ballX, ballY]);

    const destCell = useMemo(() => {
      if (ballEndX == null || ballEndY == null) return null;
      return {
        col: Math.min(XT_GRID_COLS - 1, Math.max(0, Math.floor(ballEndX / CELL_W))),
        row: Math.min(XT_GRID_ROWS - 1, Math.max(0, Math.floor(ballEndY / CELL_H))),
      };
    }, [ballEndX, ballEndY]);

    // ======================================================================
    // POINTER HANDLERS (pauses animation on drag)
    // ======================================================================
    const handlePointerDown = (id: number, e: React.PointerEvent) => {
      e.stopPropagation();
      // Pause animation instantly on drag start (Entregable 1 requirement)
      if (onDragStart) onDragStart();
      setDraggingId(id);
      if (onClickPlayer) onClickPlayer(id);
      try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    };

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (draggingId === null || !svgRef.current || !onPlayerMove) return;
        const rect = svgRef.current.getBoundingClientRect();
        const { x, y } = screenToStatsbomb(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        setHoveredZone(getTacticalZoneName(x, y));
        setDragPos({ id: draggingId, x, y });
        onPlayerMove(draggingId, x, y);
      },
      [draggingId, onPlayerMove]
    );

    const handlePointerUp = (e: React.PointerEvent) => {
      if (draggingId !== null) {
        const droppedId = draggingId;
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
        setDraggingId(null);
        setDragPos(null);
        setHoveredZone(null);
        if (onSimulationTrigger) onSimulationTrigger(droppedId);
      }
    };

    // Pass corridor polygon
    const passCorridorPolygon = useMemo(() => {
      if (ballEndX == null || ballEndY == null) return null;
      const dx = ballEndX - ballX;
      const dy = ballEndY - ballY;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const perpX = -uy;
      const perpY = ux;
      const wS = 1.6, wE = 4.4;
      return [
        `${(ballX + perpX * wS).toFixed(2)},${(ballY + perpY * wS).toFixed(2)}`,
        `${(ballEndX + perpX * wE).toFixed(2)},${(ballEndY + perpY * wE).toFixed(2)}`,
        `${(ballEndX - perpX * wE).toFixed(2)},${(ballEndY - perpY * wE).toFixed(2)}`,
        `${(ballX - perpX * wS).toFixed(2)},${(ballY - perpY * wS).toFixed(2)}`,
      ].join(" ");
    }, [ballX, ballY, ballEndX, ballEndY]);

    const actorPlayer = players.find((p) => p.is_actor) || players[0];
    const optimalTargetPlayer = useMemo(() => {
      if (!metrics?.optimal_pass_target_id) return null;
      return players.find((p) => p.player_id === metrics.optimal_pass_target_id) || null;
    }, [players, metrics?.optimal_pass_target_id]);

    // Use animated or static players, unified with instant pointer drag position for 60 FPS
    const renderPlayers = useMemo(() => {
      const base = isPlaying && animProgress > 0 ? animatedPlayers : players;
      if (!dragPos) return base;
      return base.map((p) =>
        p.player_id === dragPos.id
          ? { ...p, x: dragPos.x, y: dragPos.y, is_modified: true }
          : p
      );
    }, [isPlaying, animProgress, animatedPlayers, players, dragPos]);

    // Voronoi tessellation and territorial dispute frontier (Dr. Voronoi)
    const voronoiData = useMemo(() => {
      if (!showVoronoi) return { cells: [], frontiers: [] };
      return computeVoronoiCells(renderPlayers, STATSBOMB_PITCH_LENGTH, STATSBOMB_PITCH_WIDTH);
    }, [showVoronoi, renderPlayers]);

    return (
      <div className="relative w-full flex flex-col bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden select-none">
        {/* Top Bar - Header + Toggles */}
        <div className="flex flex-wrap items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md gap-3">
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

          {/* Toggle Bar */}
          <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setShowVoronoi(!showVoronoi)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                showVoronoi
                  ? "bg-sky-950 text-sky-300 border border-sky-500/70 shadow-sm shadow-sky-950/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
              title="Dominio Territorial Voronoi (Dr. Voronoi)"
            >
              <span className="text-xs">🔷</span>
              <span>Dominio Voronoi</span>
            </button>

            <button
              onClick={() => setShowXtGrid(!showXtGrid)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                showXtGrid
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-600/70 shadow-sm shadow-emerald-950/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
              title="Grilla xT (16x12)"
            >
              <Grid className={`w-3.5 h-3.5 ${showXtGrid ? "text-emerald-400" : "text-slate-500"}`} />
              <span>Grilla xT (16x12)</span>
            </button>

            <button
              onClick={() => setShowPassCorridor(!showPassCorridor)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                showPassCorridor
                  ? "bg-cyan-950 text-cyan-300 border border-cyan-600/70 shadow-sm shadow-cyan-950/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
              title="Sombra de Pase"
            >
              <Eye className={`w-3.5 h-3.5 ${showPassCorridor ? "text-cyan-400" : "text-slate-500"}`} />
              <span>Sombra & Pase Óptimo</span>
            </button>

            <button
              onClick={() => setShowGhostMode(!showGhostMode)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                showGhostMode
                  ? "bg-pink-950 text-pink-300 border border-pink-600/70 shadow-sm shadow-pink-950/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
              title="Vectores Fantasma"
            >
              <Ghost className={`w-3.5 h-3.5 ${showGhostMode ? "text-pink-400" : "text-slate-500"}`} />
              <span>Vectores Fantasma</span>
            </button>
          </div>
        </div>

        {/* SVG Canvas */}
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
              <pattern id="pitchGrassStripes" width="15" height="80" patternUnits="userSpaceOnUse">
                <rect width="7.5" height="80" fill="#08170e" />
                <rect x="7.5" width="7.5" height="80" fill="#06120b" />
              </pattern>
              <linearGradient id="passVisionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.28" />
                <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.32" />
              </linearGradient>
              <radialGradient id="xtOriginGlow">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
              </radialGradient>
              <radialGradient id="xtDestGlow">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
              </radialGradient>
              <marker id="ghostArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
              </marker>
              <marker id="ballArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
              </marker>
              <marker id="optimalArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#22d3ee" />
              </marker>
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

            {/* Grass */}
            <rect width="120" height="80" fill="url(#pitchGrassStripes)" />

            {/* ============================================================== */}
            {/* VORONOI TERRITORIAL DOMAIN LAYER (Dominio Voronoi - Dr. Voronoi) */}
            {/* ============================================================== */}
            {showVoronoi && (
              <g id="voronoiDominioLayer" pointerEvents="none">
                {/* Voronoi Polygons per player */}
                {voronoiData.cells.map((cell) => {
                  const isHome = cell.team === "home";
                  return (
                    <polygon
                      key={`voronoi-${cell.playerId}`}
                      points={cell.svgPoints}
                      fill={isHome ? "rgba(56, 189, 248, 0.16)" : "rgba(244, 63, 94, 0.14)"}
                      stroke={isHome ? "rgba(56, 189, 248, 0.35)" : "rgba(244, 63, 94, 0.3)"}
                      strokeWidth="0.4"
                    />
                  );
                })}

                {/* Dispute Frontiers between Teams (Demarcating with Bright Line in Offensive Third) */}
                {voronoiData.frontiers.map((f, idx) => {
                  if (f.isOffensiveThird) {
                    return (
                      <g key={`frontier-${idx}`}>
                        {/* Glowing halo */}
                        <line
                          x1={f.p1.x}
                          y1={f.p1.y}
                          x2={f.p2.x}
                          y2={f.p2.y}
                          stroke="#38bdf8"
                          strokeWidth="1.4"
                          filter="url(#haloHighlight)"
                          strokeLinecap="round"
                        />
                        {/* Bright neon core line */}
                        <line
                          x1={f.p1.x}
                          y1={f.p1.y}
                          x2={f.p2.x}
                          y2={f.p2.y}
                          stroke="#ffffff"
                          strokeWidth="0.6"
                          strokeLinecap="round"
                          opacity="0.95"
                        />
                      </g>
                    );
                  }
                  return (
                    <line
                      key={`frontier-${idx}`}
                      x1={f.p1.x}
                      y1={f.p1.y}
                      x2={f.p2.x}
                      y2={f.p2.y}
                      stroke="rgba(255, 255, 255, 0.25)"
                      strokeWidth="0.4"
                      strokeDasharray="1.5 1"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            )}

            {/* xT GRID (Toggle 1) */}
            {showXtGrid && (
              <g id="xtGridLayer" pointerEvents="all">
                {xtGridCells.map((cell) => {
                  const isOrigin = cell.col === originCell.col && cell.row === originCell.row;
                  const isDest = destCell && cell.col === destCell.col && cell.row === destCell.row;
                  let cellFill = "rgba(16, 185, 129, 0.04)";
                  if (cell.xtVal > 0.32) cellFill = `rgba(244, 63, 94, ${Math.min(0.32, cell.xtVal * 0.55)})`;
                  else if (cell.xtVal > 0.18) cellFill = `rgba(245, 158, 11, ${Math.min(0.24, cell.xtVal * 0.5)})`;
                  else if (cell.xtVal > 0.08) cellFill = `rgba(6, 182, 212, ${Math.min(0.18, cell.xtVal * 0.5)})`;

                  return (
                    <g key={`xt-${cell.col}-${cell.row}`} onMouseEnter={() => setHoveredCellXt(cell.xtVal)} onMouseLeave={() => setHoveredCellXt(null)} className="cursor-crosshair">
                      <rect x={cell.x} y={cell.y} width={CELL_W} height={CELL_H}
                        fill={isOrigin ? "url(#xtOriginGlow)" : isDest ? "url(#xtDestGlow)" : cellFill}
                        stroke={isOrigin ? "#10b981" : isDest ? "#22d3ee" : "rgba(255,255,255,0.05)"}
                        strokeWidth={isOrigin || isDest ? "0.75" : "0.15"}
                        strokeDasharray={isOrigin || isDest ? "1.5 0.8" : "none"}
                      />
                      {isOrigin && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.7} fontSize="1.7" fontWeight="bold" fontFamily="monospace" fill="#34d399" textAnchor="middle" pointerEvents="none">ORIGEN</text>
                      )}
                      {isDest && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.7} fontSize="1.7" fontWeight="bold" fontFamily="monospace" fill="#38bdf8" textAnchor="middle" pointerEvents="none">DESTINO</text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}

            {/* Pitch Markings */}
            <g stroke="rgba(255,255,255,0.22)" strokeWidth="0.38" fill="none" pointerEvents="none">
              <rect x="0" y="0" width="120" height="80" />
              <line x1="60" y1="0" x2="60" y2="80" />
              <circle cx="60" cy="40" r="9.15" />
              <circle cx="60" cy="40" r="0.6" fill="rgba(255,255,255,0.45)" stroke="none" />
              <rect x="0" y="19.85" width="16.5" height="40.3" />
              <rect x="0" y="30.85" width="5.5" height="18.3" />
              <circle cx="11" cy="40" r="0.6" fill="rgba(255,255,255,0.45)" stroke="none" />
              <path d="M 16.5 32.7 A 9.15 9.15 0 0 1 16.5 47.3" />
              <rect x="103.5" y="19.85" width="16.5" height="40.3" />
              <rect x="114.5" y="30.85" width="5.5" height="18.3" />
              <circle cx="109" cy="40" r="0.6" fill="rgba(255,255,255,0.45)" stroke="none" />
              <path d="M 103.5 32.7 A 9.15 9.15 0 0 0 103.5 47.3" />
              <path d="M 0 1 A 1 1 0 0 0 1 0" />
              <path d="M 0 79 A 1 1 0 0 1 1 80" />
              <path d="M 120 1 A 1 1 0 0 1 119 0" />
              <path d="M 120 79 A 1 1 0 0 0 119 80" />
            </g>

            {/* PASS CORRIDOR (Toggle 2) */}
            {showPassCorridor && (
              <g id="passCorridorLayer" pointerEvents="none">
                {passCorridorPolygon && (
                  <polygon points={passCorridorPolygon} fill="url(#passVisionGradient)" stroke="rgba(251,191,36,0.4)" strokeWidth="0.35" strokeDasharray="1.2 1" />
                )}
                {ballEndX != null && ballEndY != null && (
                  <g>
                    <line x1={ballX} y1={ballY} x2={ballEndX} y2={ballEndY} stroke="#fbbf24" strokeWidth="0.8" strokeDasharray="2 1.2" markerEnd="url(#ballArrowHead)" />
                    <circle cx={ballEndX} cy={ballEndY} r="1.2" fill="none" stroke="#fbbf24" strokeWidth="0.4" strokeDasharray="0.8 0.8" />
                  </g>
                )}
                {isCounterfactualMode && optimalTargetPlayer && (
                  <g id="optimalPassLine">
                    <line
                      x1={actorPlayer ? actorPlayer.x : ballX} y1={actorPlayer ? actorPlayer.y : ballY}
                      x2={optimalTargetPlayer.x} y2={optimalTargetPlayer.y}
                      stroke="#22d3ee" strokeWidth="0.9" strokeDasharray="2 1.2" markerEnd="url(#optimalArrowHead)" filter="url(#haloOptimal)"
                    />
                    {(() => {
                      const sx = actorPlayer ? actorPlayer.x : ballX;
                      const sy = actorPlayer ? actorPlayer.y : ballY;
                      const mx = (sx + optimalTargetPlayer.x) / 2;
                      const my = (sy + optimalTargetPlayer.y) / 2;
                      return (
                        <g transform={`translate(${mx}, ${my - 2.8})`}>
                          <rect x="-14" y="-2.2" width="28" height="4.4" rx="1.2" fill="#082f49" stroke="#22d3ee" strokeWidth="0.45" opacity="0.96" />
                          <text x="0" y="0.8" fontSize="2.0" fontWeight="bold" fontFamily="monospace" fill="#38bdf8" textAnchor="middle">OPCIÓN B ÓPTIMA (IA)</text>
                        </g>
                      );
                    })()}
                  </g>
                )}
              </g>
            )}

            {/* GHOST VECTORS (Toggle 3) + INERTIA RING (Entregable 2) */}
            {showGhostMode &&
              renderPlayers
                .filter((p) => p.is_modified && p.original_x != null && p.original_y != null)
                .map((p) => {
                  const origX = p.original_x!;
                  const origY = p.original_y!;
                  const distanceMeters = calculateDistanceMeters({ x: origX, y: origY }, { x: p.x, y: p.y });
                  const midX = (origX + p.x) / 2;
                  const midY = (origY + p.y) / 2;
                  const isOverInertia = distanceMeters > INERTIA_RADIUS;
                  const ringColor = isOverInertia ? "#f43f5e" : "#34d399";
                  const chipColor = isOverInertia ? "#fda4af" : "#6ee7b7";
                  const chipBorder = isOverInertia ? "#f43f5e" : "#10b981";

                  return (
                    <g key={`ghost-${p.player_id}`} pointerEvents="none">
                      {/* ============================================= */}
                      {/* ENTREGABLE 2: ANILLO DE INERCIA FÍSICA (6.0m) */}
                      {/* ============================================= */}
                      <circle
                        cx={origX} cy={origY} r={INERTIA_RADIUS}
                        fill="none" stroke={ringColor} strokeWidth="0.45"
                        strokeDasharray="1.6 1.0" opacity={0.75}
                      />
                      {/* Warning badge for >6.0m */}
                      {isOverInertia && (
                        <g transform={`translate(${origX}, ${origY - INERTIA_RADIUS - 1.8})`}>
                          <rect x="-17" y="-2.2" width="34" height="4.4" rx="1" fill="#1c0611" stroke="#f43f5e" strokeWidth="0.35" opacity="0.95" />
                          <text x="0" y="0.7" fontSize="1.7" fontWeight="bold" fontFamily="monospace" fill="#fb7185" textAnchor="middle">
                            ⚠️ &gt;6.0m Penalización Inercia
                          </text>
                        </g>
                      )}
                      {!isOverInertia && distanceMeters > 0.4 && (
                        <g transform={`translate(${origX}, ${origY - INERTIA_RADIUS - 1.2})`}>
                          <rect x="-13" y="-1.8" width="26" height="3.6" rx="1" fill="#022c22" stroke="#10b981" strokeWidth="0.3" opacity="0.9" />
                          <text x="0" y="0.6" fontSize="1.5" fontWeight="bold" fontFamily="monospace" fill="#6ee7b7" textAnchor="middle">
                            Radio Basculación Óptimo
                          </text>
                        </g>
                      )}

                      {/* Ghost arrow */}
                      <line x1={origX} y1={origY} x2={p.x} y2={p.y} stroke={chipBorder} strokeWidth="0.75" strokeDasharray="1.2 1" markerEnd="url(#ghostArrowHead)" opacity="0.95" />

                      {/* Distance chip */}
                      {distanceMeters > 0.4 && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect x="-4.5" y="-2.0" width="9" height="4" rx="1" fill="#020617" stroke={chipBorder} strokeWidth="0.35" opacity="0.95" />
                          <text x="0" y="0.8" fontSize="2.1" fontWeight="bold" fontFamily="monospace" fill={chipColor} textAnchor="middle">
                            +{distanceMeters}m
                          </text>
                        </g>
                      )}

                      {/* Ghost node at 35% opacity */}
                      <g opacity="0.35">
                        <circle cx={origX} cy={origY} r="2.6" fill={p.team === "home" ? "#2563eb" : "#dc2626"} stroke="#ffffff" strokeWidth="0.6" strokeDasharray="0.8 0.8" />
                        <text x={origX} y={origY + 0.9} fontSize="2.3" fontWeight="bold" fill="#ffffff" textAnchor="middle">{p.jersey_number}</text>
                      </g>
                    </g>
                  );
                })}

            {/* Also render inertia ring during active drag even before drop */}
            {draggingId !== null && renderPlayers
              .filter((p) => p.player_id === draggingId && p.original_x != null && p.original_y != null)
              .map((p) => {
                const origX = p.original_x ?? p.x;
                const origY = p.original_y ?? p.y;
                const dist = calculateDistanceMeters({ x: origX, y: origY }, { x: p.x, y: p.y });
                const isOver = dist > INERTIA_RADIUS;
                return (
                  <g key={`drag-ring-${p.player_id}`} pointerEvents="none">
                    <circle cx={origX} cy={origY} r={INERTIA_RADIUS} fill="none" stroke={isOver ? "#f43f5e" : "#34d399"} strokeWidth="0.5" strokeDasharray="1.6 1.0" opacity={0.8} />
                    {isOver && (
                      <g transform={`translate(${origX}, ${origY - INERTIA_RADIUS - 1.8})`}>
                        <rect x="-17" y="-2.2" width="34" height="4.4" rx="1" fill="#1c0611" stroke="#f43f5e" strokeWidth="0.35" opacity="0.95" />
                        <text x="0" y="0.7" fontSize="1.7" fontWeight="bold" fontFamily="monospace" fill="#fb7185" textAnchor="middle">⚠️ &gt;6.0m Penalización Inercia</text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* PLAYERS */}
            {renderPlayers.map((p) => {
              const isHome = p.team === "home";
              const isDragging = draggingId === p.player_id;
              const isActor = p.is_actor;
              const isHighlighted = highlightedPlayerIds.includes(p.player_id);
              const isSelected = selectedPlayerId === p.player_id;

              return (
                <g key={p.player_id} transform={`translate(${p.x}, ${p.y})`}
                  onPointerDown={(e) => handlePointerDown(p.player_id, e)}
                  onMouseEnter={() => onHoverPlayer && onHoverPlayer(p.player_id)}
                  onMouseLeave={() => onHoverPlayer && onHoverPlayer(null)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {p.is_modified && <circle r="4.4" fill="none" stroke="#f43f5e" strokeWidth="0.8" className="animate-pulse" filter="url(#haloMoved)" />}
                  {isHighlighted && <circle r="4.8" fill="none" stroke="#38bdf8" strokeWidth="0.9" className="animate-ping" filter="url(#haloHighlight)" />}
                  {isSelected && <circle r="5.2" fill="none" stroke="#22d3ee" strokeWidth="1.1" strokeDasharray="1.5 1" />}
                  {isActor && <circle r="4.0" fill="none" stroke="#fbbf24" strokeWidth="0.65" className="animate-pulse" filter="url(#haloActor)" />}
                  <circle r={isDragging ? "3.2" : "2.6"} fill={isHome ? "#1d4ed8" : "#be123c"}
                    stroke={p.is_modified ? "#fda4af" : isHighlighted || isSelected ? "#38bdf8" : "#ffffff"}
                    strokeWidth={p.is_modified || isHighlighted ? "0.9" : "0.5"}
                  />
                  <text y="0.9" fontSize="2.4" fontWeight="bold" fill="#ffffff" textAnchor="middle" pointerEvents="none">{p.jersey_number}</text>
                  <text y="5.0" fontSize="2.2" fontWeight="600" fill="#f1f5f9" textAnchor="middle" pointerEvents="none" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">{p.name.split(" ").pop()}</text>
                </g>
              );
            })}

            {/* Ball (animated during playback) */}
            <g transform={`translate(${animBallX}, ${animBallY})`} pointerEvents="none">
              <circle r="1.3" fill="#ffffff" stroke="#000000" strokeWidth="0.3" />
              <circle r="0.5" fill="#f59e0b" />
            </g>
          </svg>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/60 border-t border-slate-800/80 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <Move className="w-3.5 h-3.5 text-amber-400" />
            <span>Arrastra a cualquier jugador para simular el escenario contrafactual.</span>
          </div>
          <div className="flex items-center gap-3">
            {hoveredCellXt != null && (
              <div className="font-mono text-[10px] text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">Celda xT: {hoveredCellXt.toFixed(3)}</div>
            )}
            {hoveredZone && (
              <div className="font-mono text-[10px] text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">Zona: {hoveredZone}</div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default TacticalPitch2D;
