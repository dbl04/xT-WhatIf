"use strict";

/**
 * Voronoi Tessellation & Territorial Ownership Engine.
 * Computes exact clipped Voronoi polygons and home/away dispute frontiers
 * for the tactical pitch (120m x 80m standard StatsBomb coordinates).
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface VoronoiCellResult {
  playerId: number;
  playerName: string;
  jerseyNumber: number;
  team: "home" | "away";
  polygon: Point2D[];
  svgPoints: string;
}

export interface FrontierSegment {
  p1: Point2D;
  p2: Point2D;
  isOffensiveThird: boolean;
  homePlayerId: number;
  awayPlayerId: number;
}

export interface VoronoiComputationResult {
  cells: VoronoiCellResult[];
  frontiers: FrontierSegment[];
}

/**
 * Sutherland-Hodgman convex polygon clipping against half-plane Ax + By <= C.
 */
function clipPolygonByHalfPlane(
  polygon: Point2D[],
  A: number,
  B: number,
  C: number
): Point2D[] {
  if (polygon.length === 0) return [];
  const output: Point2D[] = [];
  const EPSILON = 1e-7;

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];

    const currentVal = A * current.x + B * current.y - C;
    const prevVal = A * prev.x + B * prev.y - C;

    const currentInside = currentVal <= EPSILON;
    const prevInside = prevVal <= EPSILON;

    if (currentInside) {
      if (!prevInside) {
        // Line crossed from outside to inside: add intersection point
        const denom = prevVal - currentVal;
        const t = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, prevVal / denom)) : 0;
        output.push({
          x: prev.x + t * (current.x - prev.x),
          y: prev.y + t * (current.y - prev.y),
        });
      }
      output.push(current);
    } else if (prevInside) {
      // Line crossed from inside to outside: add intersection point
      const denom = prevVal - currentVal;
      const t = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, prevVal / denom)) : 0;
      output.push({
        x: prev.x + t * (current.x - prev.x),
        y: prev.y + t * (current.y - prev.y),
      });
    }
  }

  return output;
}

/**
 * Computes Voronoi cells clipped to the pitch bounding box and extracts the
 * territorial dispute frontier segments between Home and Away teams.
 */
export function computeVoronoiCells(
  players: {
    player_id: number;
    name: string;
    jersey_number: number;
    team: "home" | "away";
    x: number;
    y: number;
  }[],
  pitchWidth: number = 120,
  pitchHeight: number = 80
): VoronoiComputationResult {
  if (!players || players.length === 0) {
    return { cells: [], frontiers: [] };
  }

  const baseBox: Point2D[] = [
    { x: 0, y: 0 },
    { x: pitchWidth, y: 0 },
    { x: pitchWidth, y: pitchHeight },
    { x: 0, y: pitchHeight },
  ];

  const cells: VoronoiCellResult[] = [];

  for (let i = 0; i < players.length; i++) {
    const pi = players[i];
    let poly = [...baseBox];

    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const pj = players[j];

      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < 1e-4) continue; // Skip identical/overlapping coordinates

      // Half-plane closer to pi:
      // (x - (pi.x+pj.x)/2)*dx + (y - (pi.y+pj.y)/2)*dy <= 0
      // => dx*x + dy*y <= (pj.x^2 + pj.y^2 - pi.x^2 - pi.y^2)/2
      const A = dx;
      const B = dy;
      const C = (pj.x * pj.x + pj.y * pj.y - pi.x * pi.x - pi.y * pi.y) / 2;

      poly = clipPolygonByHalfPlane(poly, A, B, C);
      if (poly.length < 3) break;
    }

    if (poly.length >= 3) {
      const svgPoints = poly
        .map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
        .join(" ");

      cells.push({
        playerId: pi.player_id,
        playerName: pi.name,
        jerseyNumber: pi.jersey_number,
        team: pi.team,
        polygon: poly,
        svgPoints,
      });
    }
  }

  // Detect dispute frontier segments between Home and Away territory
  const frontiers: FrontierSegment[] = [];

  for (let i = 0; i < players.length; i++) {
    const pi = players[i];
    if (pi.team !== "home") continue; // Check once per home-away pair

    const homeCell = cells.find((c) => c.playerId === pi.player_id);
    if (!homeCell || homeCell.polygon.length < 3) continue;

    for (let j = 0; j < players.length; j++) {
      const pj = players[j];
      if (pj.team !== "away") continue;

      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < 1e-4) continue;

      const A = dx;
      const B = dy;
      const C = (pj.x * pj.x + pj.y * pj.y - pi.x * pi.x - pi.y * pi.y) / 2;
      const normalLen = Math.sqrt(distSq);

      for (let k = 0; k < homeCell.polygon.length; k++) {
        const v1 = homeCell.polygon[k];
        const v2 = homeCell.polygon[(k + 1) % homeCell.polygon.length];

        // Perpendicular distance from vertices to bisector line Ax + By = C
        const d1 = Math.abs(A * v1.x + B * v1.y - C) / normalLen;
        const d2 = Math.abs(A * v2.x + B * v2.y - C) / normalLen;

        // If edge coincides with the perpendicular bisector line
        if (d1 < 0.08 && d2 < 0.08) {
          const edgeLength = Math.hypot(v2.x - v1.x, v2.y - v1.y);
          if (edgeLength > 0.25) {
            const midX = (v1.x + v2.x) / 2;
            // Active offensive third: x >= 60.0 (attacking half/third)
            const isOffensiveThird = midX >= 60.0;
            frontiers.push({
              p1: v1,
              p2: v2,
              isOffensiveThird,
              homePlayerId: pi.player_id,
              awayPlayerId: pj.player_id,
            });
          }
        }
      }
    }
  }

  return { cells, frontiers };
}
