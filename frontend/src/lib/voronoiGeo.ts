/**
 * Zero-dependency High-Performance Voronoi Geometry Engine for xT-WhatIf.
 * Implements Sutherland-Hodgman half-plane clipping for canonical 120x80 pitch.
 * Runs in sub-2ms on client to maintain 60 FPS during pointer drag interactions.
 */

import { PlayerNode, TeamSide } from "@/types/match";

export type Point = [number, number];

export interface VoronoiCell {
  playerId: number;
  playerName: string;
  team: TeamSide;
  polygon: Point[];
  area: number;
  centroid: Point;
  isModified: boolean;
}

export interface CollisionEdge {
  p1: Point;
  p2: Point;
  homePlayerId: number;
  awayPlayerId: number;
}

export interface VoronoiResult {
  cells: VoronoiCell[];
  collisionEdges: CollisionEdge[];
  computeTimeMs: number;
}

/**
 * Calculates area of a 2D polygon using the Shoelace formula.
 */
export function calculatePolygonArea(pts: Point[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Calculates centroid of a 2D polygon.
 */
export function calculatePolygonCentroid(pts: Point[]): Point {
  const n = pts.length;
  if (n < 3) return pts[0] || [0, 0];
  let cx = 0;
  let cy = 0;
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    signedArea += a;
    cx += (pts[i][0] + pts[j][0]) * a;
    cy += (pts[i][1] + pts[j][1]) * a;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-5) return pts[0];
  return [cx / (6.0 * signedArea), cy / (6.0 * signedArea)];
}

/**
 * Clips polygon against the half-plane Ax + By <= C (Sutherland-Hodgman).
 */
function clipPolygonAgainstHalfPlane(
  polygon: Point[],
  A: number,
  B: number,
  C: number
): Point[] {
  if (polygon.length === 0) return [];
  const outputList: Point[] = [];

  const isInside = (p: Point): boolean => A * p[0] + B * p[1] <= C + 1e-7;

  const lineIntersection = (p1: Point, p2: Point): Point => {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const denom = A * dx + B * dy;
    if (Math.abs(denom) < 1e-9) return p1;
    const t = (C - (A * p1[0] + B * p1[1])) / denom;
    return [p1[0] + t * dx, p1[1] + t * dy];
  };

  let s = polygon[polygon.length - 1];
  for (let i = 0; i < polygon.length; i++) {
    const e = polygon[i];
    if (isInside(e)) {
      if (isInside(s)) {
        outputList.push(e);
      } else {
        outputList.push(lineIntersection(s, e));
        outputList.push(e);
      }
    } else if (isInside(s)) {
      outputList.push(lineIntersection(s, e));
    }
    s = e;
  }

  return outputList;
}

/**
 * Computes Voronoi tessellation for players bounded by [minX, maxX] x [minY, maxY].
 */
export function computeVoronoiTessellation(
  players: PlayerNode[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number } = {
    minX: 0,
    maxX: 120,
    minY: 0,
    maxY: 80,
  }
): VoronoiResult {
  const t0 = performance.now();
  const validPlayers = players.filter(
    (p) =>
      p.x >= bounds.minX - 5 &&
      p.x <= bounds.maxX + 5 &&
      p.y >= bounds.minY - 5 &&
      p.y <= bounds.maxY + 5
  );

  const initialBox: Point[] = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];

  const cells: VoronoiCell[] = [];
  const collisionEdges: CollisionEdge[] = [];

  for (let i = 0; i < validPlayers.length; i++) {
    const p1 = validPlayers[i];
    let poly: Point[] = [...initialBox];

    for (let j = 0; j < validPlayers.length; j++) {
      if (i === j) continue;
      const p2 = validPlayers[j];

      // Bisector half-plane containing p1:
      // dist(Q, p1) <= dist(Q, p2)
      // 2(p2.x - p1.x)*x + 2(p2.y - p1.y)*y <= (p2.x^2 + p2.y^2) - (p1.x^2 + p1.y^2)
      const A = 2.0 * (p2.x - p1.x);
      const B = 2.0 * (p2.y - p1.y);
      const C = p2.x * p2.x + p2.y * p2.y - (p1.x * p1.x + p1.y * p1.y);

      poly = clipPolygonAgainstHalfPlane(poly, A, B, C);
      if (poly.length < 3) break;
    }

    if (poly.length >= 3) {
      const area = calculatePolygonArea(poly);
      const centroid = calculatePolygonCentroid(poly);

      cells.push({
        playerId: p1.player_id,
        playerName: p1.name,
        team: p1.team,
        polygon: poly,
        area: Math.round(area * 10) / 10,
        centroid: [Math.round(centroid[0] * 10) / 10, Math.round(centroid[1] * 10) / 10],
        isModified: Boolean(p1.is_modified),
      });
    }
  }

  // Identify collision frontiers (borders between home and away cells)
  for (let i = 0; i < cells.length; i++) {
    const c1 = cells[i];
    if (c1.team !== "home") continue;

    for (let j = 0; j < cells.length; j++) {
      const c2 = cells[j];
      if (c2.team !== "away") continue;

      // Check for shared edge points
      for (let k = 0; k < c1.polygon.length; k++) {
        const ptA = c1.polygon[k];
        const ptB = c1.polygon[(k + 1) % c1.polygon.length];

        for (let m = 0; m < c2.polygon.length; m++) {
          const ptC = c2.polygon[m];
          const ptD = c2.polygon[(m + 1) % c2.polygon.length];

          const distAC = Math.hypot(ptA[0] - ptC[0], ptA[1] - ptC[1]);
          const distBD = Math.hypot(ptB[0] - ptD[0], ptB[1] - ptD[1]);
          const distAD = Math.hypot(ptA[0] - ptD[0], ptA[1] - ptD[1]);
          const distBC = Math.hypot(ptB[0] - ptC[0], ptB[1] - ptC[1]);

          if (
            (distAC < 0.25 && distBD < 0.25) ||
            (distAD < 0.25 && distBC < 0.25)
          ) {
            // Frontier edge found
            if (ptA[0] >= 55 || ptB[0] >= 55) {
              // Priority in final half/third
              collisionEdges.push({
                p1: ptA,
                p2: ptB,
                homePlayerId: c1.playerId,
                awayPlayerId: c2.playerId,
              });
            }
          }
        }
      }
    }
  }

  const elapsed = Math.round((performance.now() - t0) * 100) / 100;
  return {
    cells,
    collisionEdges,
    computeTimeMs: elapsed,
  };
}
