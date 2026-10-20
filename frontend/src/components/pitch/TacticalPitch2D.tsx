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
import { Move } from "lucide-react";
import { Kicker } from "@/components/ui/primitives";
import { PALETTE, hair } from "@/lib/palette";
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
// BROADCAST PALETTE (inline so the PNG export keeps it)
// ======================================================================
const C = {
  ink: PALETTE.ink,
  turf: PALETTE.turf,
  turfStripe: PALETTE.turfStripe,
  line: PALETTE.pitchLine,
  white: PALETTE.fg,
  green: PALETTE.green,
  magenta: PALETTE.magenta,
  home: PALETTE.home,
  away: PALETTE.away,
} as const;

const DISPLAY_FONT = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const LAYER_TOGGLES = [
  { key: "voronoi", label: "Voronoi" },
  { key: "xt", label: "Rejilla xT" },
  { key: "pass", label: "Líneas de pase" },
  { key: "ghost", label: "Desplazamientos" },
] as const;

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
  teamShortNames?: { home: string; away: string };
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
      teamShortNames = { home: "LOC", away: "VIS" },
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

    const layerState: Record<(typeof LAYER_TOGGLES)[number]["key"], [boolean, (v: boolean) => void]> = {
      voronoi: [showVoronoi, setShowVoronoi],
      xt: [showXtGrid, setShowXtGrid],
      pass: [showPassCorridor, setShowPassCorridor],
      ghost: [showGhostMode, setShowGhostMode],
    };

    const renderInertiaPlate = (x: number, y: number, over: boolean) => (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={over ? -12.5 : -8.5} y="-1.7" width={over ? 25 : 17} height="3.4" fill={over ? C.magenta : C.ink} stroke={over ? "none" : C.white} {...hair(0.5)} />
        <text x="0" y="0.65" fontSize="1.7" fontWeight="700" letterSpacing="0.12" fill={C.white} textAnchor="middle">
          {over ? "INERCIA > 6 M · PENALIZACIÓN" : "DENTRO DEL RADIO"}
        </text>
      </g>
    );

    return (
      <div className="relative flex w-full select-none flex-col overflow-hidden rounded-lg border border-line-strong bg-ink-900">
        {/* Top Bar - Title + Layer toggles */}
        <div className="flex h-11 flex-nowrap items-center justify-between gap-3 border-b border-line px-4">
          <div className="hidden shrink-0 items-baseline gap-3 lg:flex">
            <Kicker className="text-fg">Pizarra táctica</Kicker>
            <span className="font-mono text-[10px] text-fg-subtle">Datos sintéticos · 120 × 80 m</span>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto" role="group" aria-label="Capas">
            {LAYER_TOGGLES.map(({ key, label }) => {
              const [active, setActive] = layerState[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActive(!active)}
                  aria-pressed={active}
                  className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors ${
                    active ? "bg-white/[0.07] text-fg" : "text-fg-subtle hover:bg-white/[0.04] hover:text-fg-muted"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-[1px] ${active ? "bg-signal-green" : "border border-fg-subtle"}`}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* SVG Canvas */}
        <div className="relative flex aspect-[120/80] w-full items-center justify-center bg-turf p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${STATSBOMB_PITCH_LENGTH} ${STATSBOMB_PITCH_WIDTH}`}
            className="pitch-svg h-full w-full overflow-visible"
            fontFamily={DISPLAY_FONT}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ touchAction: "none" }}
          >
            <defs>
              <pattern id="pitchGrassStripes" width="15" height="80" patternUnits="userSpaceOnUse">
                <rect width="7.5" height="80" fill={C.turf} />
                <rect x="7.5" width="7.5" height="80" fill={C.turfStripe} />
              </pattern>
              <marker id="ghostArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2" markerHeight="2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.white} />
              </marker>
              <marker id="ghostArrowHeadOver" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2" markerHeight="2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.magenta} />
              </marker>
              <marker id="ballArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2" markerHeight="2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.white} />
              </marker>
              <marker id="optimalArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.2" markerHeight="2.2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.green} />
              </marker>
            </defs>

            {/* Grass */}
            <rect width="120" height="80" fill="url(#pitchGrassStripes)" />

            {/* VORONOI TERRITORIAL LAYER */}
            {showVoronoi && (
              <g id="voronoiDominioLayer" pointerEvents="none">
                {voronoiData.cells.map((cell) => {
                  const isHome = cell.team === "home";
                  return (
                    <polygon
                      key={`voronoi-${cell.playerId}`}
                      points={cell.svgPoints}
                      fill={isHome ? "rgba(117,170,219,0.13)" : "rgba(244,240,248,0.05)"}
                      stroke={isHome ? "rgba(117,170,219,0.38)" : "rgba(244,240,248,0.2)"}
                      {...hair(0.5)}
                    />
                  );
                })}

                {/* Dispute frontiers: solid in the offensive third, dashed elsewhere */}
                {voronoiData.frontiers.map((f, idx) => (
                  <line
                    key={`frontier-${idx}`}
                    x1={f.p1.x}
                    y1={f.p1.y}
                    x2={f.p2.x}
                    y2={f.p2.y}
                    stroke={f.isOffensiveThird ? C.white : "rgba(255,255,255,0.28)"}
                    strokeDasharray={f.isOffensiveThird ? undefined : "3 3"}
                    opacity={f.isOffensiveThird ? 0.9 : 1}
                    {...hair(f.isOffensiveThird ? 1 : 0.5)}
                  />
                ))}
              </g>
            )}

            {/* xT GRID */}
            {showXtGrid && (
              <g id="xtGridLayer" pointerEvents="all">
                {xtGridCells.map((cell) => {
                  const isOrigin = cell.col === originCell.col && cell.row === originCell.row;
                  const isDest = destCell && cell.col === destCell.col && cell.row === destCell.row;
                  const cellFill = `rgba(0,255,133,${Math.min(0.24, cell.xtVal * 0.42).toFixed(3)})`;

                  return (
                    <g key={`xt-${cell.col}-${cell.row}`} onMouseEnter={() => setHoveredCellXt(cell.xtVal)} onMouseLeave={() => setHoveredCellXt(null)} className="cursor-crosshair">
                      <rect x={cell.x} y={cell.y} width={CELL_W} height={CELL_H}
                        fill={cellFill}
                        stroke={isOrigin ? C.white : isDest ? C.green : "rgba(255,255,255,0.05)"}
                        {...hair(isOrigin || isDest ? 1 : 0.5)}
                      />
                      {isOrigin && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.6} fontSize="1.7" fontWeight="700" letterSpacing="0.15" fill={C.white} textAnchor="middle" pointerEvents="none">ORIGEN</text>
                      )}
                      {isDest && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.6} fontSize="1.7" fontWeight="700" letterSpacing="0.15" fill={C.green} textAnchor="middle" pointerEvents="none">DESTINO</text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}

            {/* Pitch Markings — 0.5px hairlines */}
            <g stroke={C.line} fill="none" pointerEvents="none">
              <rect x="0" y="0" width="120" height="80" {...hair(1)} />
              <line x1="60" y1="0" x2="60" y2="80" {...hair()} />
              <circle cx="60" cy="40" r="9.15" {...hair()} />
              <circle cx="60" cy="40" r="0.45" fill={C.line} stroke="none" />
              <rect x="0" y="19.85" width="16.5" height="40.3" {...hair()} />
              <rect x="0" y="30.85" width="5.5" height="18.3" {...hair()} />
              <circle cx="11" cy="40" r="0.35" fill={C.line} stroke="none" />
              <path d="M 16.5 32.7 A 9.15 9.15 0 0 1 16.5 47.3" {...hair()} />
              <rect x="103.5" y="19.85" width="16.5" height="40.3" {...hair()} />
              <rect x="114.5" y="30.85" width="5.5" height="18.3" {...hair()} />
              <circle cx="109" cy="40" r="0.35" fill={C.line} stroke="none" />
              <path d="M 103.5 32.7 A 9.15 9.15 0 0 0 103.5 47.3" {...hair()} />
              <path d="M 0 1 A 1 1 0 0 0 1 0" {...hair()} />
              <path d="M 0 79 A 1 1 0 0 1 1 80" {...hair()} />
              <path d="M 120 1 A 1 1 0 0 1 119 0" {...hair()} />
              <path d="M 120 79 A 1 1 0 0 0 119 80" {...hair()} />
            </g>

            {/* PASS CORRIDOR */}
            {showPassCorridor && (
              <g id="passCorridorLayer" pointerEvents="none">
                {passCorridorPolygon && (
                  <polygon points={passCorridorPolygon} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" {...hair(0.5)} />
                )}
                {ballEndX != null && ballEndY != null && (
                  <g>
                    <line x1={ballX} y1={ballY} x2={ballEndX} y2={ballEndY} stroke={C.white} strokeDasharray="5 4" markerEnd="url(#ballArrowHead)" {...hair(1)} />
                    <circle cx={ballEndX} cy={ballEndY} r="1.2" fill="none" stroke={C.white} {...hair(0.5)} />
                  </g>
                )}
                {isCounterfactualMode && optimalTargetPlayer && (
                  <g id="optimalPassLine">
                    <line
                      x1={actorPlayer ? actorPlayer.x : ballX} y1={actorPlayer ? actorPlayer.y : ballY}
                      x2={optimalTargetPlayer.x} y2={optimalTargetPlayer.y}
                      stroke={C.green} markerEnd="url(#optimalArrowHead)" {...hair(1.5)}
                    />
                    {(() => {
                      const sx = actorPlayer ? actorPlayer.x : ballX;
                      const sy = actorPlayer ? actorPlayer.y : ballY;
                      const mx = (sx + optimalTargetPlayer.x) / 2;
                      const my = (sy + optimalTargetPlayer.y) / 2;
                      return (
                        <g transform={`translate(${mx}, ${my - 2.8})`}>
                          <rect x="-9.5" y="-1.8" width="19" height="3.6" fill={C.green} />
                          <text x="0" y="0.7" fontSize="1.9" fontWeight="800" letterSpacing="0.15" fill={C.ink} textAnchor="middle">OPCIÓN ÓPTIMA</text>
                        </g>
                      );
                    })()}
                  </g>
                )}
              </g>
            )}

            {/* GHOST VECTORS + INERTIA RING */}
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
                  const accent = isOverInertia ? C.magenta : C.white;

                  return (
                    <g key={`ghost-${p.player_id}`} pointerEvents="none">
                      {/* Physical inertia ring (6.0 m) */}
                      <circle cx={origX} cy={origY} r={INERTIA_RADIUS} fill="none" stroke={accent} strokeDasharray="4 3" opacity={0.8} {...hair(isOverInertia ? 1 : 0.5)} />
                      {distanceMeters > 0.4 &&
                        renderInertiaPlate(origX, origY - INERTIA_RADIUS - 1.6, isOverInertia)}

                      {/* Ghost arrow */}
                      <line x1={origX} y1={origY} x2={p.x} y2={p.y} stroke={accent} strokeDasharray="3 2" markerEnd={isOverInertia ? "url(#ghostArrowHeadOver)" : "url(#ghostArrowHead)"} {...hair(1)} />

                      {/* Distance chip */}
                      {distanceMeters > 0.4 && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect x="-4" y="-1.7" width="8" height="3.4" fill={C.ink} stroke={accent} {...hair(0.5)} />
                          <text x="0" y="0.75" fontSize="2" fontWeight="700" fill={accent} textAnchor="middle">
                            +{distanceMeters}m
                          </text>
                        </g>
                      )}

                      {/* Ghost node */}
                      <g opacity="0.45">
                        <circle cx={origX} cy={origY} r="2.4" fill="none" stroke={p.team === "home" ? C.home : C.away} strokeDasharray="2 2" {...hair(1)} />
                        <text x={origX} y={origY + 0.85} fontSize="2.3" fontWeight="700" fill={C.white} textAnchor="middle">{p.jersey_number}</text>
                      </g>
                    </g>
                  );
                })}

            {/* Inertia ring during active drag, before drop */}
            {draggingId !== null && renderPlayers
              .filter((p) => p.player_id === draggingId && p.original_x != null && p.original_y != null)
              .map((p) => {
                const origX = p.original_x ?? p.x;
                const origY = p.original_y ?? p.y;
                const dist = calculateDistanceMeters({ x: origX, y: origY }, { x: p.x, y: p.y });
                const isOver = dist > INERTIA_RADIUS;
                return (
                  <g key={`drag-ring-${p.player_id}`} pointerEvents="none">
                    <circle cx={origX} cy={origY} r={INERTIA_RADIUS} fill="none" stroke={isOver ? C.magenta : C.white} strokeDasharray="4 3" opacity={0.85} {...hair(isOver ? 1 : 0.5)} />
                    {isOver && renderInertiaPlate(origX, origY - INERTIA_RADIUS - 1.6, true)}
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
                  {isSelected && <circle r="5.1" fill="none" stroke={C.white} strokeDasharray="2 2" {...hair(0.5)} />}
                  {isHighlighted && <circle r="4.5" fill="none" stroke={C.white} {...hair(1.5)} />}
                  {isActor && <circle r="3.7" fill="none" stroke={C.green} {...hair(1.5)} />}
                  {p.is_modified && !isActor && <circle r="3.7" fill="none" stroke={C.white} strokeDasharray="2 1.5" {...hair(1)} />}
                  <circle r={isDragging ? "3" : "2.5"} fill={isHome ? C.home : C.away} stroke={C.ink} {...hair(0.5)} />
                  <text y="0.85" fontSize="2.5" fontWeight="700" fill={C.ink} textAnchor="middle" pointerEvents="none">{p.jersey_number}</text>
                  <text y="5.3" fontSize="2.1" fontWeight="600" letterSpacing="0.08" fill={C.white} stroke={C.ink} strokeWidth="0.5" paintOrder="stroke" textAnchor="middle" pointerEvents="none">{(p.name.split(" ").pop() || "").toUpperCase()}</text>
                </g>
              );
            })}

            {/* Ball (animated during playback) */}
            <g transform={`translate(${animBallX}, ${animBallY})`} pointerEvents="none">
              <circle r="1.1" fill={C.white} stroke={C.ink} {...hair(1)} />
            </g>
          </svg>
        </div>

        {/* Footer: hint, legend, readouts */}
        <div className="flex h-8 flex-nowrap items-center justify-between gap-4 border-t border-line px-4 text-[11px] text-fg-subtle">
          <div className="flex min-w-0 items-center gap-2">
            <Move className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Arrastra a cualquier jugador para simular el escenario.</span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden items-center gap-3 font-mono text-[10px] uppercase tracking-wide md:flex">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-home" />{teamShortNames.home}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-away" />{teamShortNames.away}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-signal-green" />Con balón</span>
              <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-signal-green" />Pase óptimo</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-signal-magenta" />Inercia &gt; 6 m</span>
            </div>
            {hoveredCellXt != null && (
              <span className="font-mono text-[10px] text-fg-muted">xT celda <span className="text-signal-green">{hoveredCellXt.toFixed(3)}</span></span>
            )}
            {hoveredZone && (
              <span className="font-mono text-[10px] text-fg-muted">Zona <span className="text-fg">{hoveredZone}</span></span>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default TacticalPitch2D;
