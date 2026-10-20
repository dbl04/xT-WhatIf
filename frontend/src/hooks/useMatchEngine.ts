"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MatchFramePayload,
  PlayerNode,
  CounterfactualRequest,
} from "@/types/match";
import sampleMockFrame from "@/mocks/sample_frame.json";
import curatedGoldenFrames from "@/mocks/match_3869685_frames.json";

// Catálogo Oficial de los 5 Golden Highlights del Mundial 2022 (Argentina vs Francia)
// 100% de paridad con backend/app/data/cache/match_3869685_frames.json
export const DEFAULT_OFFLINE_FRAMES: MatchFramePayload[] =
  curatedGoldenFrames as MatchFramePayload[];

export interface UseMatchEngineOptions {
  matchId?: number;
  apiUrl?: string;
  wsUrl?: string;
}

export type ConnectionMode = "live" | "offline";

export function useMatchEngine({
  matchId = 3869685,
  apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws",
}: UseMatchEngineOptions = {}) {
  // Lista de frames cargados y frame activo
  const [frames, setFrames] = useState<MatchFramePayload[]>(DEFAULT_OFFLINE_FRAMES);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);

  // Estados de conexión y estado real-time
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("offline");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [thinkingMessage, setThinkingMessage] = useState<string>(
    "Recalculando geometría xT y consultando agentes..."
  );

  // Sincronización cruzada de iluminación bidireccional
  const [highlightedPlayerIds, setHighlightedPlayerIds] = useState<number[]>([]);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  // Referencias internas
  const baseFramesRef = useRef<MatchFramePayload[]>(DEFAULT_OFFLINE_FRAMES);
  const socketRef = useRef<WebSocket | null>(null);

  // 1. Carga inicial de frames desde GET /api/v1/match/{matchId}/frames (Resiliencia total Hackathon-Proof)
  useEffect(() => {
    let isCancelled = false;

    async function loadFrames() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const response = await fetch(`${apiUrl}/api/v1/match/${matchId}/frames`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: MatchFramePayload[] = await response.json();
        if (!isCancelled && Array.isArray(data) && data.length > 0) {
          setFrames(data);
          baseFramesRef.current = JSON.parse(JSON.stringify(data));
          setConnectionMode("live");
          setIsConnected(true);
        }
      } catch (err) {
        if (!isCancelled) {
          // Fallback silencioso y elegante a offline demo mode
          console.info(
            "Backend FastAPI no disponible o fuera de línea. Activando OFFLINE DEMO MODE con datos curados.",
            err
          );
          setFrames(DEFAULT_OFFLINE_FRAMES);
          baseFramesRef.current = JSON.parse(JSON.stringify(DEFAULT_OFFLINE_FRAMES));
          setConnectionMode("offline");
          setIsConnected(false);
        }
      }
    }

    loadFrames();

    return () => {
      isCancelled = true;
    };
  }, [apiUrl, matchId]);

  // 2. Conexión WebSocket bidireccional si el backend está disponible
  useEffect(() => {
    const fullWsUrl = `${wsUrl}/match/${matchId}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(fullWsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionMode("live");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "INITIAL_FRAME" && message.payload) {
            setFrames((prev) => {
              const updated = [...prev];
              updated[0] = message.payload;
              return updated;
            });
            setIsThinking(false);
          } else if (message.type === "SIMULATION_UPDATE" && message.payload) {
            setFrames((prev) => {
              const updated = [...prev];
              const idx = updated.findIndex(
                (f) => f.event_uuid === message.payload.event_uuid
              );
              if (idx !== -1) {
                updated[idx] = message.payload;
              } else {
                updated[currentFrameIndex] = message.payload;
              }
              return updated;
            });
            setIsThinking(false);
          }
        } catch (e) {
          console.error("Error procesando mensaje WebSocket:", e);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [wsUrl, matchId, currentFrameIndex]);

  // Frame actual activo
  const currentFrame =
    frames[currentFrameIndex] ||
    frames[0] ||
    (DEFAULT_OFFLINE_FRAMES[0] as MatchFramePayload);

  // 3. Actualización de posición de jugador (en coordenadas canónicas StatsBomb 120x80)
  const updatePlayerPosition = useCallback(
    (playerId: number, newX: number, newY: number) => {
      setFrames((prevFrames) => {
        const nextFrames = [...prevFrames];
        const active = { ...nextFrames[currentFrameIndex] };

        active.players = active.players.map((p) => {
          if (p.player_id === playerId) {
            return {
              ...p,
              x: newX,
              y: newY,
              original_x: p.original_x ?? p.x,
              original_y: p.original_y ?? p.y,
              is_modified: true,
            };
          }
          return p;
        });

        // Marca el frame como modo contrafactual inmediatamente
        active.is_counterfactual_mode = true;
        nextFrames[currentFrameIndex] = active;
        return nextFrames;
      });
    },
    [currentFrameIndex]
  );

  // 4. Disparar Simulación Contrafactual (onPlayerDrop)
  const triggerSimulation = useCallback(
    async (customPlayers?: PlayerNode[]) => {
      setIsThinking(true);
      setThinkingMessage("Recalculando geometría xT y consultando agentes...");

      const activeFrame = frames[currentFrameIndex];
      const playersToSimulate = customPlayers || activeFrame.players;

      const requestPayload: CounterfactualRequest = {
        match_id: activeFrame.match_id,
        event_uuid: activeFrame.event_uuid,
        modified_players: playersToSimulate,
      };

      // Si tenemos WebSocket abierto, enviamos por WS
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "SIMULATE_MOVE",
            payload: requestPayload,
          })
        );
        return;
      }

      // Si estamos en modo LIVE backend pero no WS, usamos POST /api/v1/simulate
      if (connectionMode === "live") {
        try {
          const res = await fetch(`${apiUrl}/api/v1/simulate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload),
          });

          if (res.ok) {
            const simulated: MatchFramePayload = await res.json();
            setFrames((prev) => {
              const next = [...prev];
              next[currentFrameIndex] = simulated;
              return next;
            });
            setIsThinking(false);
            return;
          }
        } catch (e) {
          console.warn("Fallo en POST /api/v1/simulate, recurriendo a simulación offline:", e);
        }
      }

      // Modo Offline / Resiliencia total: Cálculo heurístico inmediato de xT y debate multiagente
      setTimeout(() => {
        setFrames((prev) => {
          const next = [...prev];
          const frame = { ...next[currentFrameIndex] };
          const modified = frame.players.filter((p) => p.is_modified);
          const actor = frame.players.find((p) => p.is_actor) || frame.players[0];

          // Distancia del actor a portería rival (120.0, 40.0)
          const distToGoal = Math.hypot(120.0 - actor.x, 40.0 - actor.y);
          const baseThreat = Math.max(0.05, Math.min(0.95, 0.75 - (distToGoal / 120.0) * 0.6));

          // Efecto de los defensores desplazados
          let penalty = 0;
          modified.forEach((mp) => {
            if (mp.team !== actor.team) {
              const distToBall = Math.hypot(mp.x - actor.x, mp.y - actor.y);
              if (distToBall < 15.0) {
                penalty += (15.0 - distToBall) * 0.025;
              }
            }
          });

          const simXt = Math.max(0.04, Number((baseThreat - penalty).toFixed(2)));
          const delta = Number((simXt - frame.metrics.original_xt).toFixed(2));
          const isUp = delta >= 0;

          // Espacio controlado
          const spaceControl = Math.max(
            15.0,
            Math.min(85.0, Number((frame.metrics.space_control_home_pct + (isUp ? 8 : -14)).toFixed(1)))
          );

          // Probabilidad de pase
          const passProb = Math.max(
            10.0,
            Math.min(95.0, Number((frame.metrics.pass_completion_prob + (isUp ? 12 : -22)).toFixed(1)))
          );

          // Identificar target óptimo alternativo
          const potentialTargets = frame.players.filter(
            (p) => p.team === actor.team && p.player_id !== actor.player_id && !p.is_keeper
          );
          const optimalTarget =
            potentialTargets.length > 0 ? potentialTargets[0].player_id : frame.metrics.optimal_pass_target_id;

          const modifiedNames = modified.map((m) => m.name).join(", ") || "jugador";

          frame.is_counterfactual_mode = true;
          frame.metrics = {
            ...frame.metrics,
            simulated_xt: simXt,
            xt_delta: delta,
            space_control_home_pct: spaceControl,
            pass_completion_prob: passProb,
            optimal_pass_target_id: optimalTarget,
          };

          frame.agent_debate = [
            {
              message_id: `msg-sim-${Date.now()}-voronoi`,
              agent_role: "data_scientist",
              agent_name: "Dr. Voronoi (Data Scientist)",
              avatar_badge: "AI-QUANT",
              timestamp_label: `${frame.minute}:${String(frame.second).padStart(2, "0")} [SIMULACIÓN]`,
              headline: isUp
                ? `Ganancia neta de peligro espacial (+${delta.toFixed(2)} xT)`
                : `Colapso del peligro esperado (${delta.toFixed(2)} en xT relativo)`,
              analysis_body: isUp
                ? `Al reposicionar a ${modifiedNames}, el receptor gana 3.4m² de separación en el polígono de control. La probabilidad de completitud sube a ${passProb}%.`
                : `El ajuste defensivo de ${modifiedNames} intercepta el cono de pase natural. El peligro decae de ${frame.metrics.original_xt.toFixed(2)} a ${simXt.toFixed(2)}.`,
              referenced_metric: `ΔxT: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} | Prob: ${passProb}%`,
              highlighted_player_ids: modified.map((m) => m.player_id),
            },
            {
              message_id: `msg-sim-${Date.now()}-bianchi`,
              agent_role: "classic_coach",
              agent_name: "Míster Bianchi (Entrenador Clásico)",
              avatar_badge: "PRO-COACH",
              timestamp_label: `${frame.minute}:${String(frame.second).padStart(2, "0")} [SIMULACIÓN]`,
              headline: isUp
                ? "Espacio generado a la espalda; hay que picar al vacío"
                : "Se cierra la ventana directa; activar la Opción B",
              analysis_body: isUp
                ? `Bien visto el movimiento de ${modifiedNames}. Si el volante central no hace la cobertura de inmediato, tenemos ventaja para definir al segundo palo.`
                : `Con esa basculación nos taparon el pase cantado. Ojo a la descarga por dentro: el pase alternativo a la espalda del pivote queda libre.`,
              referenced_metric: isUp ? "Apertura de Intervalo Defensivo" : "Cobertura Interior Forzada",
              highlighted_player_ids: [actor.player_id, ...(modified.map((m) => m.player_id))],
            },
          ];

          return next;
        });

        setIsThinking(false);
      }, 450);
    },
    [apiUrl, connectionMode, currentFrameIndex, frames]
  );

  // Manejador específico para cuando el usuario suelta el jugador arrastrado
  const onPlayerDrop = useCallback(
    (playerId: number) => {
      triggerSimulation();
    },
    [triggerSimulation]
  );

  // 5. Restablecer al frame base original del momento seleccionado
  const resetSimulation = useCallback(() => {
    const base = baseFramesRef.current[currentFrameIndex] || DEFAULT_OFFLINE_FRAMES[currentFrameIndex];
    setFrames((prev) => {
      const next = [...prev];
      next[currentFrameIndex] = JSON.parse(JSON.stringify(base));
      return next;
    });
    setIsThinking(false);
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
  }, [currentFrameIndex]);

  // 6. Cambiar de momento clave del partido
  const selectFrameIndex = useCallback((index: number) => {
    if (index >= 0) {
      setCurrentFrameIndex(index);
      setIsThinking(false);
      setHighlightedPlayerIds([]);
      setHoveredPlayerId(null);
    }
  }, []);

  return {
    frames,
    currentFrameIndex,
    currentFrame,
    connectionMode,
    isConnected,
    isThinking,
    thinkingMessage,
    highlightedPlayerIds,
    setHighlightedPlayerIds,
    hoveredPlayerId,
    setHoveredPlayerId,
    selectFrameIndex,
    updatePlayerPosition,
    onPlayerDrop,
    triggerSimulation,
    resetSimulation,
  };
}

export default useMatchEngine;
