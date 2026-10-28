"use strict";
"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { PlayerNode, TacticalMetrics } from "@/types/match";
import {
  STATSBOMB_PITCH_LENGTH,
  STATSBOMB_PITCH_WIDTH,
  calculateDistanceMeters,
  getTacticalZoneName,
  TacticalZone,
} from "@/lib/coordinates";
import { useI18n } from "@/lib/i18n";
import { Move, ZoomIn, Maximize2 } from "lucide-react";
import { Kicker } from "@/components/ui/primitives";
import { PALETTE, hair, withAlpha } from "@/lib/palette";
import { computeVoronoiCells } from "@/lib/voronoi";
import { XT_GRID_COLS, XT_GRID_ROWS, xtCell } from "@/lib/xt";

// ======================================================================
// ARCHITECTURE CONSTANTS
// ======================================================================
const CELL_W = STATSBOMB_PITCH_LENGTH / XT_GRID_COLS; // 7.5m
const CELL_H = STATSBOMB_PITCH_WIDTH / XT_GRID_ROWS; // 6.6667m

/** Physical inertia radius (kept in sync with the backend tactical_math.py) */
const INERTIA_RADIUS = 6.0;

/** Base animation duration in ms (adjusted by speed multiplier) */
const BASE_ANIM_DURATION_MS = 2000;

/** Player disc radius and label sizes (pitch units = metres). */
const PLAYER_R = 1.7;
const NUMBER_FONT = 1.75;
const NAME_FONT = 1.5;

/** Zoom framing: players this close to the ball / target / carrier are part of the action. */
const FOCUS_NEIGHBOUR_M = 25;
const FOCUS_PADDING_M = 6;
const FOCUS_MIN_WIDTH = 54;
const VIEWBOX_ANIM_MS = 450;

// ======================================================================
// BROADCAST PALETTE (inline so the PNG export keeps it)
// ======================================================================
const C = {
  ink: PALETTE.ink,
  turf: PALETTE.turf,
  turfStripe: PALETTE.turfStripe,
  line: PALETTE.pitchLine,
  white: PALETTE.fg,
  gain: PALETTE.gain,
  loss: PALETTE.loss,
  red: PALETTE.red,
  home: PALETTE.home,
  away: PALETTE.away,
} as const;

const DISPLAY_FONT = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const LAYER_TOGGLES = [
  { key: "voronoi", label: "layer.voronoi" },
  { key: "xt", label: "layer.xt" },
  { key: "pass", label: "layer.pass" },
  { key: "ghost", label: "layer.ghost" },
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
  /** Challenge mode overlay; null/undefined for the free analysis board. */
  challenge?: PitchChallenge | null;
  /** Nothing can be dragged (the live match outside a key moment). */
  readOnly?: boolean;
  /** Maximum players that can be moved on the Key Moments board (defaults to 2). */
  maxFreeMoves?: number;
  /** Fired when the user tries to drag a 3rd player on the Key Moments board. */
  onFreeMoveLimitReached?: () => void;
}

/** Challenge overlay: who may move, the hard radius and the offside line. */
export interface PitchChallenge {
  mode?: "attack" | "defend";
  movableIds: number[];
  maxRadius: number;
  maxPlayers: number;
  offsideLineX: number | null;
  /** Board locked (submitted): nothing can be dragged. */
  locked: boolean;
  /** Short, translated rule labels per player (server or offline violations). */
  violationLabels: Record<number, string>;
  /** A locked player or a third player was grabbed. */
  onBlocked?: (playerId: number, reason: "locked" | "limit") => void;
  /** Reveal: the optimum moves, drawn as green arrows to green target rings. */
  optimum?: { player_id: number; fromX: number; fromY: number; x: number; y: number }[];
  /** Reveal: the optimum's pass, from the ball to its receiver; `changed` when it is a new receiver. */
  optimumPass?: { fromX: number; fromY: number; toX: number; toY: number; changed: boolean };
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_VIEW: ViewBox = { x: 0, y: 0, w: STATSBOMB_PITCH_LENGTH, h: STATSBOMB_PITCH_WIDTH };

export interface TacticalPitch2DHandle {
  getSvgElement: () => SVGSVGElement | null;
}

// ======================================================================
// ZOOM FRAMING
// ======================================================================
/**
 * Box around the action (ball, ball end, carrier and the players within FOCUS_NEIGHBOUR_M of
 * them, at their ORIGINAL positions so it does not move while dragging), padded, widened to
 * the 3:2 pitch ratio and clamped inside the pitch.
 */
function computeFocusBox(
  players: PlayerNode[],
  ballX: number,
  ballY: number,
  ballEndX?: number | null,
  ballEndY?: number | null
): ViewBox {
  const origin = (p: PlayerNode) => ({ x: p.original_x ?? p.x, y: p.original_y ?? p.y });
  const anchors = [{ x: ballX, y: ballY }];
  if (ballEndX != null && ballEndY != null) anchors.push({ x: ballEndX, y: ballEndY });
  const actor = players.find((p) => p.is_actor);
  if (actor) anchors.push(origin(actor));

  const points = [...anchors];
  players.forEach((p) => {
    const o = origin(p);
    if (anchors.some((a) => Math.hypot(a.x - o.x, a.y - o.y) <= FOCUS_NEIGHBOUR_M)) points.push(o);
  });

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ratio = STATSBOMB_PITCH_LENGTH / STATSBOMB_PITCH_WIDTH;
  let w = maxX - minX + FOCUS_PADDING_M * 2;
  const h0 = maxY - minY + FOCUS_PADDING_M * 2;
  if (w / h0 < ratio) w = h0 * ratio;
  w = Math.min(STATSBOMB_PITCH_LENGTH, Math.max(FOCUS_MIN_WIDTH, w));
  const h = w / ratio;
  const x = Math.max(0, Math.min(STATSBOMB_PITCH_LENGTH - w, (minX + maxX) / 2 - w / 2));
  const y = Math.max(0, Math.min(STATSBOMB_PITCH_WIDTH - h, (minY + maxY) / 2 - h / 2));
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    w: Number(w.toFixed(2)),
    h: Number(h.toFixed(2)),
  };
}

/** Animates the viewBox towards `target` (ease-out), instantly under reduced motion. */
function useAnimatedViewBox(target: ViewBox): ViewBox {
  const [box, setBox] = useState<ViewBox>(target);
  const boxRef = useRef<ViewBox>(target);
  const { x, y, w, h } = target;

  useEffect(() => {
    const from = boxRef.current;
    const to = { x, y, w, h };
    if (from.x === x && from.y === y && from.w === w && from.h === h) return;
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      boxRef.current = to;
      setBox(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - start) / VIEWBOX_ANIM_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const next = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      };
      boxRef.current = next;
      setBox(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [x, y, w, h]);

  return box;
}

// ======================================================================
// NAME LABELS (greedy placement: below, then above, else hidden)
// ======================================================================
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const shortName = (name: string) => (name.split(" ").pop() || "").toUpperCase();

const LABEL_BELOW = PLAYER_R + NAME_FONT + 0.1;
const LABEL_ABOVE = -PLAYER_R - 0.45;

/**
 * Baseline offset (from the player centre) of each name that is shown. Players are taken in
 * `order`: a `forced` one always gets a label; the others only when it fits without covering
 * another label or player disc.
 */
function placeNameLabels(
  players: PlayerNode[],
  order: { id: number; forced: boolean }[],
  reserved: Rect[]
): Map<number, number> {
  const byId = new Map(players.map((p) => [p.player_id, p]));
  const placed: Rect[] = [...reserved];
  const result = new Map<number, number>();

  order.forEach(({ id, forced }) => {
    const p = byId.get(id);
    if (!p) return;
    const halfW = (shortName(p.name).length * NAME_FONT * 0.56) / 2 + 0.3;
    const rectFor = (dy: number): Rect => ({
      x0: p.x - halfW,
      x1: p.x + halfW,
      y0: p.y + dy - NAME_FONT * 0.8,
      y1: p.y + dy + NAME_FONT * 0.2,
    });
    const free = (r: Rect) =>
      !placed.some((q) => overlaps(r, q)) &&
      !players.some(
        (o) =>
          o.player_id !== id &&
          overlaps(r, { x0: o.x - PLAYER_R, y0: o.y - PLAYER_R, x1: o.x + PLAYER_R, y1: o.y + PLAYER_R })
      );
    let dy: number | null = null;
    if (free(rectFor(LABEL_BELOW))) dy = LABEL_BELOW;
    else if (free(rectFor(LABEL_ABOVE))) dy = LABEL_ABOVE;
    else if (forced) dy = LABEL_BELOW;
    if (dy == null) return;
    placed.push(rectFor(dy));
    result.set(id, dy);
  });
  return result;
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
      challenge = null,
      readOnly = false,
      maxFreeMoves = 2,
      onFreeMoveLimitReached,
    },
    ref
  ) {
    const { t } = useI18n();
    // Toggle states
    const [showVoronoi, setShowVoronoi] = useState<boolean>(false);
    const [showXtGrid, setShowXtGrid] = useState<boolean>(true);
    const [showPassCorridor, setShowPassCorridor] = useState<boolean>(true);
    const [showGhostMode, setShowGhostMode] = useState<boolean>(true);

    // Interaction states
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
    const [hoveredZone, setHoveredZone] = useState<TacticalZone | null>(null);
    const [hoveredCellXt, setHoveredCellXt] = useState<number | null>(null);
    const [isZoomed, setIsZoomed] = useState<boolean>(true);
    const svgRef = useRef<SVGSVGElement | null>(null);

    const movableSet = useMemo(() => new Set(challenge?.movableIds ?? []), [challenge?.movableIds]);

    // ============================================================
    // CINEMATIC PLAYBACK (requestAnimationFrame)
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
          cells.push({ col, row, x: col * CELL_W, y: row * CELL_H, xtVal: xtCell(col, row) });
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
    /**
     * Pointer → pitch coordinates through the SVG's own screen transform, so it stays exact
     * whatever the viewBox (zoom), letterboxing or padding. Clamped inside the pitch, 0.1 m.
     */
    const toPitch = (clientX: number, clientY: number) => {
      const ctm = svgRef.current?.getScreenCTM();
      if (!ctm) return null;
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      const margin = 0.5;
      return {
        x: Number(Math.max(margin, Math.min(STATSBOMB_PITCH_LENGTH - margin, pt.x)).toFixed(1)),
        y: Number(Math.max(margin, Math.min(STATSBOMB_PITCH_WIDTH - margin, pt.y)).toFixed(1)),
      };
    };

    const handlePointerDown = (id: number, e: React.PointerEvent) => {
      e.stopPropagation();
      if (onClickPlayer) onClickPlayer(id);
      if (readOnly) return;
      if (challenge) {
        if (challenge.locked) return;
        if (!movableSet.has(id)) {
          challenge.onBlocked?.(id, "locked");
          return;
        }
        const othersMoved = players.filter((p) => p.is_modified && p.player_id !== id).length;
        if (othersMoved >= challenge.maxPlayers) {
          challenge.onBlocked?.(id, "limit");
          return;
        }
      } else {
        const othersMoved = players.filter((p) => p.is_modified && p.player_id !== id).length;
        if (othersMoved >= maxFreeMoves) {
          onFreeMoveLimitReached?.();
          return;
        }
      }
      // Pause the animation as soon as a drag starts
      if (onDragStart) onDragStart();
      setDraggingId(id);
      try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (draggingId === null || !onPlayerMove) return;
      const point = toPitch(e.clientX, e.clientY);
      if (!point) return;
      let { x, y } = point;
      if (challenge) {
        // Hard limit: the player cannot leave the ring around the original position.
        const p = players.find((q) => q.player_id === draggingId);
        if (p) {
          const ox = p.original_x ?? p.x;
          const oy = p.original_y ?? p.y;
          const d = Math.hypot(x - ox, y - oy);
          const limit = Math.max(0, challenge.maxRadius - 0.06);
          if (d > limit && d > 0) {
            x = Number((ox + ((x - ox) / d) * limit).toFixed(1));
            y = Number((oy + ((y - oy) / d) * limit).toFixed(1));
          }
        }
      }
      setHoveredZone(getTacticalZoneName(x, y));
      setDragPos({ id: draggingId, x, y });
      onPlayerMove(draggingId, x, y);
    };

    // Drop a drag in progress if the board gets locked (e.g. the clock runs out mid-gesture).
    useEffect(() => {
      if ((challenge?.locked || readOnly) && draggingId !== null) {
        setDraggingId(null);
        setDragPos(null);
        setHoveredZone(null);
      }
    }, [challenge?.locked, readOnly, draggingId]);

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
        `${(ballX + perpX * wS).toFixed(2)},${(ballY + perpX * wS).toFixed(2)}`,
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

    // Zoom on the area of interest (stable while dragging: uses original positions).
    const focusBox = useMemo(
      () => computeFocusBox(players, ballX, ballY, ballEndX, ballEndY),
      // Only the moment's geometry matters, not every drag tick.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        ballX,
        ballY,
        ballEndX,
        ballEndY,
        players.map((p) => `${p.player_id}:${p.original_x ?? p.x}:${p.original_y ?? p.y}:${p.is_actor ? 1 : 0}`).join("|"),
      ]
    );
    const viewBox = useAnimatedViewBox(isZoomed ? focusBox : FULL_VIEW);
    const isFramed = viewBox.w < STATSBOMB_PITCH_LENGTH - 0.01;

    // Distance chips of moved players reserve their space before the names are placed.
    const showGhosts = showGhostMode || !!challenge;
    const violationRects = useMemo<Rect[]>(() => {
      const rects: Rect[] = [];
      renderPlayers.forEach((p) => {
        if (showGhosts && p.is_modified && p.original_x != null && p.original_y != null) {
          const mx = (p.original_x + p.x) / 2;
          const my = (p.original_y + p.y) / 2;
          if (Math.hypot(p.x - p.original_x, p.y - p.original_y) > 0.4) {
            rects.push({ x0: mx - 3.4, x1: mx + 3.4, y0: my - 1.4, y1: my + 1.4 });
          }
        }
      });
      return rects;
    }, [challenge, renderPlayers, showGhosts]);

    // Which names are shown and where. In challenge mode only the carrier, movable,
    // highlighted and hovered players carry a name; the rest stay as numbered discs.
    const nameOffsets = useMemo(() => {
      const CONGESTION_RADIUS_M = 3.5;
      const rank = (p: PlayerNode) => {
        if (p.player_id === draggingId) return 0;
        if (p.is_actor) return 1;
        if (p.player_id === selectedPlayerId) return 2;
        if (highlightedPlayerIds.includes(p.player_id)) return 3;
        if (p.is_modified) return 4;
        if (challenge && movableSet.has(p.player_id)) return 5;
        return 6;
      };
      const isCongested = (p: PlayerNode) =>
        renderPlayers.some(
          (o) => o.player_id !== p.player_id && Math.hypot(o.x - p.x, o.y - p.y) < CONGESTION_RADIUS_M
        );
      const order = renderPlayers
        .filter((p) => (!challenge || rank(p) <= 5) && (rank(p) <= 2 || !isCongested(p)))
        .map((p) => ({ id: p.player_id, r: rank(p) }))
        .sort((a, b) => a.r - b.r)
        .map(({ id, r }) => ({ id, forced: r <= 2 }));
      return placeNameLabels(renderPlayers, order, violationRects);
    }, [renderPlayers, draggingId, selectedPlayerId, highlightedPlayerIds, challenge, movableSet, violationRects]);

    const renderInertiaPlate = (x: number, y: number, over: boolean) => (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={over ? -12.5 : -8.5} y="-1.7" width={over ? 25 : 17} height="3.4" fill={over ? C.loss : C.ink} stroke={over ? "none" : C.white} {...hair(0.5)} />
        <text x="0" y="0.65" fontSize="1.7" fontWeight="700" letterSpacing="0.12" fill={C.white} textAnchor="middle">
          {over ? t("pitch.inertiaOver") : t("pitch.inertiaOk")}
        </text>
      </g>
    );

    return (
      <div className="relative flex w-full select-none flex-col overflow-hidden rounded-lg border border-line-strong bg-ink-900">
        {/* Waiting for key moment banner above the pitch in Live Match */}
        {readOnly && (
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-8 items-center justify-center gap-2 border-b border-line bg-amber-400/10 px-4 py-1.5 text-center text-xs font-medium text-amber-200"
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" aria-hidden />
            <span>{t("live.waitingPitchBanner")}</span>
          </div>
        )}

        {/* Top Bar - Title + Layer toggles */}
        <div className="flex h-11 flex-nowrap items-center justify-between gap-3 border-b border-line px-4">
          <div className="hidden shrink-0 items-baseline gap-3 lg:flex">
            <Kicker className="text-fg">{t("pitch.title")}</Kicker>
          </div>

          {/* View: zoom on the action / full pitch */}
          <div
            className="flex shrink-0 items-center rounded-md border border-line p-0.5"
            role="group"
            aria-label={t("pitch.viewAria")}
          >
            {[
              { zoomed: true, label: t("pitch.zoom"), Icon: ZoomIn },
              { zoomed: false, label: t("pitch.full"), Icon: Maximize2 },
            ].map(({ zoomed, label, Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => setIsZoomed(zoomed)}
                aria-pressed={isZoomed === zoomed}
                title={label}
                className={`flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal-gain ${
                  isZoomed === zoomed ? "bg-white/[0.1] text-fg" : "text-fg-subtle hover:text-fg-muted"
                }`}
              >
                <Icon className="h-3 w-3" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto" role="group" aria-label={t("pitch.layers")}>
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
                    className={`h-1.5 w-1.5 rounded-[1px] ${active ? "bg-signal-gain" : "border border-fg-subtle"}`}
                  />
                  {t(label)}
                </button>
              );
            })}
          </div>
        </div>

        {/* SVG Canvas */}
        <div className="relative flex aspect-[120/80] w-full items-center justify-center bg-turf p-2">
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className={`pitch-svg h-full w-full ${isFramed ? "overflow-hidden" : "overflow-visible"}`}
            data-zoomed={isFramed ? "true" : "false"}
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
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.loss} />
              </marker>
              <marker id="ballArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2" markerHeight="2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.white} />
              </marker>
              <marker id="optimalArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.2" markerHeight="2.2" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill={C.gain} />
              </marker>
            </defs>

            {/* Pitch Base */}
            <rect x="0" y="0" width="120" height="80" fill="url(#pitchGrassStripes)" />

            {/* VORONOI TESSELLATION + DISPUTE FRONTIER */}
            {showVoronoi && (
              <g id="voronoiLayer" pointerEvents="none">
                {voronoiData.cells.map((cell) => {
                  const isHome = cell.team === "home";
                  const fillColor = isHome ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)";
                  return (
                    <g key={`voronoi-${cell.playerId}`}>
                      <polygon
                        points={cell.svgPoints}
                        fill={fillColor}
                        stroke="rgba(255,255,255,0.12)"
                        {...hair(0.5)}
                      />
                    </g>
                  );
                })}
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
                  // Hide ORIGIN and TARGET squares when outside a key moment (readOnly live match)
                  const isOrigin = !readOnly && cell.col === originCell.col && cell.row === originCell.row;
                  const isDest = !readOnly && destCell && cell.col === destCell.col && cell.row === destCell.row;
                  const isDefend = challenge?.mode === "defend";
                  const destColor = isDefend ? C.loss : C.gain;
                  const cellFill = withAlpha(C.gain, Number(Math.min(0.24, cell.xtVal * 0.42).toFixed(3)));

                  return (
                    <g key={`xt-${cell.col}-${cell.row}`} onMouseEnter={() => setHoveredCellXt(cell.xtVal)} onMouseLeave={() => setHoveredCellXt(null)} className="cursor-crosshair">
                      <rect x={cell.x} y={cell.y} width={CELL_W} height={CELL_H}
                        fill={cellFill}
                        stroke={isOrigin ? C.white : isDest ? destColor : "rgba(255,255,255,0.05)"}
                        {...hair(isOrigin || isDest ? 1 : 0.5)}
                      />
                      {isOrigin && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.6} fontSize="1.7" fontWeight="700" letterSpacing="0.15" fill={C.white} textAnchor="middle" pointerEvents="none">{t("pitch.origin")}</text>
                      )}
                      {isDest && (
                        <text x={cell.x + CELL_W / 2} y={cell.y + CELL_H / 2 + 0.6} fontSize="1.7" fontWeight="700" letterSpacing="0.15" fill={destColor} textAnchor="middle" pointerEvents="none">
                          {isDefend ? t("pitch.dangerZone") : t("pitch.target")}
                        </text>
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
                {isCounterfactualMode && !challenge && optimalTargetPlayer && (
                  <g id="optimalPassLine">
                    <line
                      x1={actorPlayer ? actorPlayer.x : ballX} y1={actorPlayer ? actorPlayer.y : ballY}
                      x2={optimalTargetPlayer.x} y2={optimalTargetPlayer.y}
                      stroke={C.gain} markerEnd="url(#optimalArrowHead)" {...hair(1.5)}
                    />
                    {(() => {
                      const sx = actorPlayer ? actorPlayer.x : ballX;
                      const sy = actorPlayer ? actorPlayer.y : ballY;
                      const mx = (sx + optimalTargetPlayer.x) / 2;
                      const my = (sy + optimalTargetPlayer.y) / 2;
                      return (
                        <g transform={`translate(${mx}, ${my - 2.8})`}>
                          <rect x="-9.5" y="-1.8" width="19" height="3.6" fill={C.gain} />
                          <text x="0" y="0.7" fontSize="1.9" fontWeight="800" letterSpacing="0.15" fill={C.ink} textAnchor="middle">{t("pitch.bestOption")}</text>
                        </g>
                      );
                    })()}
                  </g>
                )}
              </g>
            )}

            {/* OFFSIDE LINE (challenge, attack) */}
            {challenge && challenge.offsideLineX != null && (
              <g pointerEvents="none" aria-hidden>
                <line
                  x1={challenge.offsideLineX}
                  y1={0}
                  x2={challenge.offsideLineX}
                  y2={STATSBOMB_PITCH_WIDTH}
                  stroke={C.white}
                  strokeDasharray="2.5 1.5"
                  opacity={0.8}
                  {...hair(1.25)}
                />
                <g transform={`translate(${challenge.offsideLineX}, ${viewBox.y + viewBox.h - 2.2})`}>
                  <rect
                    x={-(t("pitch.offside").length * 1.3 * 0.6) / 2 - 0.6}
                    y="-1.1"
                    width={t("pitch.offside").length * 1.3 * 0.6 + 1.2}
                    height="2.2"
                    fill={C.ink}
                    stroke={C.white}
                    opacity={0.9}
                    {...hair(0.5)}
                  />
                  <text y="0.45" fontSize="1.3" fontWeight="700" letterSpacing="0.1" fill={C.white} textAnchor="middle">
                    {t("pitch.offside")}
                  </text>
                </g>
              </g>
            )}

            {/* GHOST VECTORS + INERTIA RING (in challenge mode the ring is the hard limit, always shown) */}
            {(showGhostMode || challenge) &&
              renderPlayers
                .filter((p) => p.is_modified && p.original_x != null && p.original_y != null)
                .map((p) => {
                  const origX = p.original_x!;
                  const origY = p.original_y!;
                  const distanceMeters = calculateDistanceMeters({ x: origX, y: origY }, { x: p.x, y: p.y });
                  const midX = (origX + p.x) / 2;
                  const midY = (origY + p.y) / 2;
                  const ringRadius = challenge ? challenge.maxRadius : INERTIA_RADIUS;
                  const isOverInertia = !challenge && distanceMeters > INERTIA_RADIUS;
                  const accent = isOverInertia ? C.loss : C.white;

                  return (
                    <g key={`ghost-${p.player_id}`} pointerEvents="none">
                      {/* Physical inertia ring (6.0 m) */}
                      <circle cx={origX} cy={origY} r={ringRadius} fill={challenge ? "rgba(255,255,255,0.04)" : "none"} stroke={accent} strokeDasharray="4 3" opacity={0.8} {...hair(isOverInertia ? 1 : 0.5)} />
                      {distanceMeters > 0.4 && !challenge &&
                        renderInertiaPlate(origX, origY - INERTIA_RADIUS - 1.6, isOverInertia)}

                      {/* Ghost arrow */}
                      <line x1={origX} y1={origY} x2={p.x} y2={p.y} stroke={accent} strokeDasharray="3 2" markerEnd={isOverInertia ? "url(#ghostArrowHeadOver)" : "url(#ghostArrowHead)"} {...hair(1)} />

                      {/* Distance chip */}
                      {distanceMeters > 0.4 && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect x="-3.4" y="-1.4" width="6.8" height="2.8" fill={C.ink} stroke={accent} {...hair(0.5)} />
                          <text x="0" y="0.55" fontSize="1.6" fontWeight="700" fill={accent} textAnchor="middle">
                            +{distanceMeters}m
                          </text>
                        </g>
                      )}

                      {/* Ghost node */}
                      <g opacity="0.45">
                        <circle cx={origX} cy={origY} r={PLAYER_R} fill="none" stroke={p.team === "home" ? C.home : C.away} strokeDasharray="1.5 1.5" {...hair(1)} />
                        <text x={origX} y={origY + NUMBER_FONT * 0.35} fontSize={NUMBER_FONT} fontWeight="700" fill={C.white} textAnchor="middle">{p.jersey_number}</text>
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
                const isOver = !challenge && dist > INERTIA_RADIUS;
                return (
                  <g key={`drag-ring-${p.player_id}`} pointerEvents="none">
                    <circle cx={origX} cy={origY} r={challenge ? challenge.maxRadius : INERTIA_RADIUS} fill="none" stroke={isOver ? C.loss : C.white} strokeDasharray="4 3" opacity={0.85} {...hair(isOver ? 1 : 0.5)} />
                    {isOver && renderInertiaPlate(origX, origY - INERTIA_RADIUS - 1.6, true)}
                  </g>
                );
              })}

            {/* REVEAL: the optimum's pass, labelled when the moves send the ball to a new receiver */}
            {challenge?.optimumPass && (() => {
              const pass = challenge.optimumPass;
              const label = t(pass.changed ? "pitch.newPass" : "pitch.bestOption");
              const w = label.length * 1.15 + 2;
              return (
                <g id="optimumPassLine" pointerEvents="none" data-changed={pass.changed ? "true" : "false"}>
                  <line x1={pass.fromX} y1={pass.fromY} x2={pass.toX} y2={pass.toY} stroke={C.gain} markerEnd="url(#optimalArrowHead)" {...hair(1.5)} />
                  <g transform={`translate(${(pass.fromX + pass.toX) / 2}, ${(pass.fromY + pass.toY) / 2 - 2.8})`}>
                    <rect x={-w / 2} y="-1.8" width={w} height="3.6" fill={C.gain} />
                    <text x="0" y="0.7" fontSize="1.9" fontWeight="800" letterSpacing="0.15" fill={C.ink} textAnchor="middle">{label}</text>
                  </g>
                </g>
              );
            })()}

            {/* REVEAL: optimum moves (green arrow from the original spot to the best spot) */}
            {challenge?.optimum?.map((m) => (
              <g key={`opt-${m.player_id}`} pointerEvents="none" data-optimum-for={m.player_id}>
                <line x1={m.fromX} y1={m.fromY} x2={m.x} y2={m.y} stroke={C.gain} strokeDasharray="1.6 1" {...hair(2)} />
                <circle cx={m.x} cy={m.y} r={PLAYER_R + 1.1} fill={C.gain} fillOpacity={0.18} stroke={C.gain} {...hair(2)} />
                <circle cx={m.x} cy={m.y} r={0.45} fill={C.gain} />
              </g>
            ))}

            {/* PLAYERS */}
            {renderPlayers.map((p) => {
              const isHome = p.team === "home";
              const isDragging = draggingId === p.player_id;
              const isActor = p.is_actor;
              const isHighlighted = highlightedPlayerIds.includes(p.player_id);
              const isSelected = selectedPlayerId === p.player_id;
              const isMovable = !!challenge && !challenge.locked && movableSet.has(p.player_id);
              const isLocked = !!challenge && !movableSet.has(p.player_id);
              const nameDy = nameOffsets.get(p.player_id);
              const violation = challenge?.violationLabels[p.player_id];
              const cursor = readOnly
                ? "cursor-default"
                : !challenge
                ? "cursor-grab active:cursor-grabbing"
                : isMovable
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-default";

              return (
                <g key={p.player_id} transform={`translate(${p.x}, ${p.y})`}
                  onPointerDown={(e) => handlePointerDown(p.player_id, e)}
                  onMouseEnter={() => onHoverPlayer && onHoverPlayer(p.player_id)}
                  onMouseLeave={() => onHoverPlayer && onHoverPlayer(null)}
                  className={cursor}
                  opacity={isLocked && !isActor && !isHighlighted && !isSelected ? 0.42 : 1}
                  data-player-id={p.player_id}
                  data-movable={challenge ? (isMovable ? "true" : "false") : undefined}
                >
                  {/* Generous invisible hit area so small discs stay easy to grab on touch */}
                  <circle r={PLAYER_R + 1.1} fill="transparent" />
                  {isSelected && <circle r={PLAYER_R + 1.7} fill="none" stroke={C.white} strokeDasharray="1.5 1.5" {...hair(0.5)} />}
                  {isHighlighted && <circle r={PLAYER_R + 1.3} fill="none" stroke={C.white} {...hair(1.5)} />}
                  {isActor && <circle r={PLAYER_R + 0.85} fill="none" stroke={C.gain} {...hair(1.5)} />}
                  {p.is_modified && !isActor && <circle r={PLAYER_R + 0.85} fill="none" stroke={C.white} strokeDasharray="1.5 1" {...hair(1)} />}
                  {isMovable && !p.is_modified && (
                    <circle r={PLAYER_R + 0.7} fill="none" stroke={C.gain} strokeDasharray="1.2 0.9" opacity={0.85} {...hair(1)} />
                  )}
                  {/* A broken rule is a red ring; the reason is in the challenge card (and the tooltip). */}
                  {violation && (
                    <>
                      <title>{violation}</title>
                      <circle r={PLAYER_R + 0.9} fill={C.red} fillOpacity={0.28} stroke={C.red} {...hair(2)} pointerEvents="none" />
                    </>
                  )}
                  <circle r={isDragging ? PLAYER_R + 0.35 : PLAYER_R} fill={isHome ? C.home : C.away} stroke={violation ? C.red : C.ink} {...hair(violation ? 1.5 : 0.5)} />
                  <text y={NUMBER_FONT * 0.35} fontSize={NUMBER_FONT} fontWeight="700" fill={C.ink} textAnchor="middle" pointerEvents="none">{p.jersey_number}</text>
                  {nameDy != null && (
                    <text y={nameDy} fontSize={NAME_FONT} fontWeight="600" letterSpacing="0.06" fill={C.white} stroke={C.ink} strokeWidth="0.4" paintOrder="stroke" textAnchor="middle" pointerEvents="none">{shortName(p.name)}</text>
                  )}
                </g>
              );
            })}

            {/* Ball (animated during playback) */}
            <g transform={`translate(${animBallX}, ${animBallY})`} pointerEvents="none">
              <circle r="0.85" fill={C.white} stroke={C.ink} {...hair(1)} />
            </g>
          </svg>
        </div>

        {/* Footer: hint, legend, readouts */}
        <div className="flex h-8 flex-nowrap items-center justify-between gap-4 border-t border-line px-4 text-[11px] text-fg-subtle">
          <div className="flex min-w-0 items-center gap-2">
            {readOnly ? (
              <span className="truncate">{t("live.waitingMoment")}</span>
            ) : (
              !challenge?.locked && (
                <>
                  <Move className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {challenge ? t("challenge.hint", { n: challenge.maxPlayers, r: challenge.maxRadius }) : t("pitch.hint")}
                  </span>
                </>
              )
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden items-center gap-3 font-mono text-[10px] uppercase tracking-wide md:flex">
              <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-signal-gain" />{t("pitch.bestPass")}</span>
            </div>
            {hoveredCellXt != null && (
              <span className="font-mono text-[10px] text-fg-muted">{t("pitch.cellXt")} <span className="text-signal-gain">{hoveredCellXt.toFixed(3)}</span></span>
            )}
            {hoveredZone && (
              <span className="font-mono text-[10px] text-fg-muted">{t("pitch.zone")} <span className="text-fg">{t(`zone.${hoveredZone}`)}</span></span>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default TacticalPitch2D;
