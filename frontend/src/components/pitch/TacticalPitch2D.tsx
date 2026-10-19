"use strict";
"use client";

import React, { useState, useRef, useCallback } from "react";
import { PlayerNode } from "@/types/match";
import {
  STATSBOMB_PITCH_LENGTH,
  STATSBOMB_PITCH_WIDTH,
  screenToStatsbomb,
  calculateDistanceMeters,
  getTacticalZoneName,
} from "@/lib/coordinates";
import { Move, Sparkles, Layers, Compass, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface TacticalPitch2DProps {
  players: PlayerNode[];
  ballX: number;
  ballY: number;
  ballEndX?: number | null;
  ballEndY?: number | null;
  highlightedPlayerIds?: number[];
  onPlayerMove?: (playerId: number, newX: number, newY: number) => void;
  onSimulationTrigger?: () => void;
}

export const TacticalPitch2D: React.FC<TacticalPitch2DProps> = ({
  players,
  ballX,
  ballY,
  ballEndX,
  ballEndY,
  highlightedPlayerIds = [],
  onPlayerMove,
  onSimulationTrigger,
}) => {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [showPitchGrid, setShowPitchGrid] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pure StatsBomb Coordinate Handler via lib/coordinates.ts
  const handlePointerDown = (id: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setDraggingId(id);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingId === null || !svgRef.current || !onPlayerMove) return;

      const rect = svgRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Pure coordinate conversion strictly clamped to [0.0..120.0, 0.0..80.0]
      const { x, y } = screenToStatsbomb(clientX, clientY, rect.width, rect.height);
      setHoveredZone(getTacticalZoneName(x, y));
      onPlayerMove(draggingId, x, y);
    },
    [draggingId, onPlayerMove]
  );

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId !== null) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      setDraggingId(null);
      setHoveredZone(null);
      if (onSimulationTrigger) {
        onSimulationTrigger();
      }
    }
  };

  return (
    <div className="relative w-full flex flex-col bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden select-none">
      {/* Top Bar - Broadcast Pro Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-500/50" />
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-slate-100">
              Cancha Táctica StatsBomb 360
            </span>
            <span className="ml-2 font-mono text-[10px] text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50">
              120.0m × 80.0m
            </span>
          </div>
        </div>

        {/* Tactical Legend */}
        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-blue-400">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block ring-2 ring-blue-500/20" /> Argentina
          </span>
          <span className="flex items-center gap-1.5 text-rose-400">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block ring-2 ring-rose-500/20" /> Francia
          </span>
          <span className="flex items-center gap-1.5 text-pink-400">
            <span className="w-2.5 h-2.5 rounded-full border border-pink-400 border-dashed inline-block" /> Posición Fantasma
          </span>
        </div>
      </div>

      {/* Interactive Pitch Canvas Container */}
      <div className="relative w-full aspect-[120/80] bg-[#08150d] p-3 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${STATSBOMB_PITCH_LENGTH} ${STATSBOMB_PITCH_WIDTH}`}
          className="w-full h-full rounded-xl shadow-inner border border-emerald-950/80"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: "none" }}
        >
          <defs>
            {/* Césped estilizado Pro Dark */}
            <pattern id="pitchGrassStripes" width="12" height="80" patternUnits="userSpaceOnUse">
              <rect width="6" height="80" fill="#08180e" />
              <rect x="6" width="6" height="80" fill="#06130b" />
            </pattern>

            {/* Marcador de punta de flecha para el vector contrafactual */}
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

            {/* Marcador de vector de pase del balón */}
            <marker
              id="ballArrowHead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
            </marker>

            {/* Filtros Glow */}
            <filter id="haloMoved" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#f43f5e" floodOpacity="0.9" />
            </filter>
            <filter id="haloActor" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#fbbf24" floodOpacity="0.85" />
            </filter>
            <filter id="haloHighlight" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#38bdf8" floodOpacity="1" />
            </filter>
          </defs>

          {/* Grass Field Rect */}
          <rect width="120" height="80" fill="url(#pitchGrassStripes)" />

          {/* Líneas Oficiales StatsBomb (120 x 80) */}
          <g stroke="rgba(255, 255, 255, 0.22)" strokeWidth="0.38" fill="none">
            {/* Perímetro */}
            <rect x="0" y="0" width="120" height="80" />
            {/* Línea media */}
            <line x1="60" y1="0" x2="60" y2="80" />
            {/* Círculo central (R = 9.15) */}
            <circle cx="60" cy="40" r="9.15" />
            <circle cx="60" cy="40" r="0.6" fill="rgba(255, 255, 255, 0.45)" stroke="none" />

            {/* Área Grande Izquierda (16.5m de fondo, Y de 19.85 a 60.15) */}
            <rect x="0" y="19.85" width="16.5" height="40.3" />
            {/* Área Chica Izquierda (5.5m fondo, Y de 30.85 a 49.15) */}
            <rect x="0" y="30.85" width="5.5" height="18.3" />
            {/* Punto penal izq (11m) */}
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

          {/* Trayectoria Proyectada del Pase Real */}
          {ballEndX != null && ballEndY != null && (
            <g>
              <line
                x1={ballX}
                y1={ballY}
                x2={ballEndX}
                y2={ballEndY}
                stroke="#fbbf24"
                strokeWidth="0.75"
                strokeDasharray="2 1.2"
                markerEnd="url(#ballArrowHead)"
              />
              <circle cx={ballEndX} cy={ballEndY} r="1.1" fill="none" stroke="#fbbf24" strokeWidth="0.4" strokeDasharray="0.8 0.8" />
            </g>
          )}

          {/* ============================================================== */}
          {/* REGLA ARQUITECTÓNICA ESTRICTA #3: EFECTO GHOST (FANTASMA)       */}
          {/* ============================================================== */}
          {players
            .filter((p) => p.is_modified && p.original_x != null && p.original_y != null)
            .map((p) => {
              const origX = p.original_x!;
              const origY = p.original_y!;
              const distanceMeters = calculateDistanceMeters({ x: origX, y: origY }, { x: p.x, y: p.y });
              const midX = (origX + p.x) / 2;
              const midY = (origY + p.y) / 2;

              return (
                <g key={`ghost-effect-${p.player_id}`}>
                  {/* 1. Flecha Vectorial Punteada desde posición original a nueva posición */}
                  <line
                    x1={origX}
                    y1={origY}
                    x2={p.x}
                    y2={p.y}
                    stroke="#f43f5e"
                    strokeWidth="0.7"
                    strokeDasharray="1.2 1"
                    markerEnd="url(#ghostArrowHead)"
                    opacity="0.9"
                  />

                  {/* Badge de Distancia de Desplazamiento en Metros */}
                  {distanceMeters > 0.5 && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-4.5"
                        y="-2.0"
                        width="9"
                        height="4"
                        rx="1"
                        fill="#020617"
                        stroke="#f43f5e"
                        strokeWidth="0.3"
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

                  {/* 2. Nodo Semitransparente (35% opacidad, borde punteado) en (original_x, original_y) */}
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
                      pointerEvents="none"
                    >
                      {p.jersey_number}
                    </text>
                  </g>
                </g>
              );
            })}

          {/* ============================================================== */}
          {/* JUGADORES (Sólidos, Interactivos con Drag & Drop)                */}
          {/* ============================================================== */}
          {players.map((p) => {
            const isHome = p.team === "home";
            const isDragging = draggingId === p.player_id;
            const isActor = p.is_actor;
            const isHighlighted = highlightedPlayerIds.includes(p.player_id);

            return (
              <g
                key={p.player_id}
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={(e) => handlePointerDown(p.player_id, e)}
                className="cursor-grab active:cursor-grabbing transition-transform duration-75"
              >
                {/* 3. Halo Brillante cuando el jugador ha sido modificado */}
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

                {/* Halo de Destacado / Iluminación del Debate AI */}
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

                {/* Halo de Actor (Portador del balón) */}
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
                  stroke={p.is_modified ? "#fda4af" : isHighlighted ? "#38bdf8" : "#ffffff"}
                  strokeWidth={p.is_modified ? "0.9" : "0.5"}
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
                  className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
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

      {/* Footer Helper & Tactical Telemetry Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/60 border-t border-slate-800/80 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <Move className="w-3.5 h-3.5 text-amber-400" />
          <span>Arrastra a cualquier jugador en el campo para simular un escenario contrafactual.</span>
        </div>
        {hoveredZone && (
          <div className="font-mono text-[10px] text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">
            Zona: {hoveredZone}
          </div>
        )}
      </div>
    </div>
  );
};

export default TacticalPitch2D;
