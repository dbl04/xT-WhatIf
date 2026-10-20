"use strict";
"use client";

import React, { useMemo } from "react";
import { PlayerNode, TeamSide } from "@/types/match";
import { computeVoronoiTessellation } from "@/lib/voronoiGeo";

export interface VoronoiOverlayProps {
  players: PlayerNode[];
  possessionTeam: TeamSide;
  visible: boolean;
  activeZoneOnly?: boolean; // Si true, enfoca en [60, 120] x [0, 80]
}

export const VoronoiOverlaySVG: React.FC<VoronoiOverlayProps> = ({
  players,
  possessionTeam,
  visible,
  activeZoneOnly = false,
}) => {
  const tessellation = useMemo(() => {
    if (!visible || players.length === 0) return null;

    const bounds = activeZoneOnly
      ? { minX: 60, maxX: 120, minY: 0, maxY: 80 }
      : { minX: 0, maxX: 120, minY: 0, maxY: 80 };

    return computeVoronoiTessellation(players, bounds);
  }, [visible, players, activeZoneOnly]);

  if (!visible || !tessellation) return null;

  return (
    <g className="pointer-events-none" id="voronoi-overlay-group">
      {/* 1. Voronoi Polygons */}
      {tessellation.cells.map((cell) => {
        const isHome = cell.team === "home";
        const pointsStr = cell.polygon.map((pt) => `${pt[0]},${pt[1]}`).join(" ");

        return (
          <g key={`voronoi-cell-${cell.playerId}`}>
            <polygon
              points={pointsStr}
              fill={isHome ? "rgba(56, 189, 248, 0.14)" : "rgba(244, 63, 94, 0.14)"}
              stroke={isHome ? "rgba(56, 189, 248, 0.45)" : "rgba(244, 63, 94, 0.45)"}
              strokeWidth="0.35"
              strokeDasharray={cell.isModified ? "1.5, 0.8" : undefined}
            />

            {/* If modified, show centroid badge with area */}
            {cell.isModified && cell.polygon.length >= 3 && (
              <g transform={`translate(${cell.centroid[0]}, ${cell.centroid[1]})`}>
                <circle
                  r="1.2"
                  fill={isHome ? "rgba(56, 189, 248, 0.9)" : "rgba(244, 63, 94, 0.9)"}
                  stroke="#ffffff"
                  strokeWidth="0.25"
                />
                <rect
                  x="-7"
                  y="-4.5"
                  width="14"
                  height="3.2"
                  rx="1"
                  fill="rgba(15, 23, 42, 0.85)"
                  stroke={isHome ? "#38bdf8" : "#f43f5e"}
                  strokeWidth="0.2"
                />
                <text
                  x="0"
                  y="-2.4"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="2"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {cell.area}m²
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 2. Collision Frontiers (Home vs Away Clash Boundaries in Final Third) */}
      {tessellation.collisionEdges.map((edge, idx) => (
        <line
          key={`collision-edge-${idx}`}
          x1={edge.p1[0]}
          y1={edge.p1[1]}
          x2={edge.p2[0]}
          y2={edge.p2[1]}
          stroke="rgba(251, 191, 36, 0.85)"
          strokeWidth="0.65"
          strokeDasharray="1.2, 0.8"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
};
