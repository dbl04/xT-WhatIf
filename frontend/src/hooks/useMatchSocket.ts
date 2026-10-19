"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MatchFramePayload, PlayerNode, CounterfactualRequest } from "@/types/match";
import sampleMockFrame from "@/mocks/sample_frame.json";

interface UseMatchSocketOptions {
  matchId?: number;
  wsUrl?: string;
}

export const useMatchSocket = ({
  matchId = 3869685,
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws",
}: UseMatchSocketOptions = {}) => {
  const [currentFrame, setCurrentFrame] = useState<MatchFramePayload>(sampleMockFrame as MatchFramePayload);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [highlightedPlayerIds, setHighlightedPlayerIds] = useState<number[]>([]);

  const socketRef = useRef<WebSocket | null>(null);

  // Connect WebSocket with offline mock fallback
  useEffect(() => {
    const fullUrl = `${wsUrl}/match/${matchId}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(fullUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "INITIAL_FRAME" || data.type === "SIMULATION_UPDATE") {
            setCurrentFrame(data.payload);
            setIsThinking(false);
          }
        } catch (err) {
          console.error("Error al procesar mensaje de WebSocket:", err);
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
      if (ws) ws.close();
    };
  }, [matchId, wsUrl]);

  // Actualizar coordenadas de un jugador en coordenadas canónicas 120x80
  const updatePlayerPosition = useCallback((playerId: number, newX: number, newY: number) => {
    setCurrentFrame((prev) => {
      const updatedPlayers = prev.players.map((p) => {
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

      // Cálculo heurístico local preliminar
      const actor = updatedPlayers.find((p) => p.is_actor) || updatedPlayers[0];
      const distToGoal = Math.hypot(120.0 - actor.x, 40.0 - actor.y);
      const estXt = Math.max(0.05, Math.min(0.95, 0.65 - (distToGoal / 120.0) * 0.5));
      const delta = estXt - prev.metrics.original_xt;

      return {
        ...prev,
        is_counterfactual_mode: true,
        players: updatedPlayers,
        metrics: {
          ...prev.metrics,
          simulated_xt: Number(estXt.toFixed(2)),
          xt_delta: Number(delta.toFixed(2)),
        },
      };
    });
  }, []);

  // Enviar petición de simulación contrafactual
  const triggerSimulation = useCallback(() => {
    setIsThinking(true);
    const requestPayload: CounterfactualRequest = {
      match_id: currentFrame.match_id,
      event_uuid: currentFrame.event_uuid,
      modified_players: currentFrame.players,
    };

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "SIMULATE_MOVE",
          payload: requestPayload,
        })
      );
    } else {
      // Simulación offline rápida de respaldo
      setTimeout(() => {
        setIsThinking(false);
        const delta = currentFrame.metrics.xt_delta;
        const isUp = delta >= 0;

        setCurrentFrame((prev) => ({
          ...prev,
          agent_debate: [
            {
              message_id: `msg-${Date.now()}-1`,
              agent_role: "data_scientist",
              agent_name: "Dr. Voronoi (Data Scientist)",
              avatar_badge: "AI-QUANT",
              timestamp_label: `${prev.minute}:${String(prev.second).padStart(2, "0")} [SIMULACIÓN]`,
              headline: isUp
                ? `Incremento de amenaza ofensiva (+${delta.toFixed(2)} xT)`
                : `Colapso del peligro esperado (${delta.toFixed(2)} en xT relativo)`,
              analysis_body: isUp
                ? "El desplazamiento amplía el polígono de control en zona de aceleración. Aumenta la probabilidad de finalización."
                : "La nueva marca absorbe el ángulo de recepción. El xT cae considerablemente respecto a la acción real.",
              referenced_metric: `ΔxT: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} | Prob: ${prev.metrics.pass_completion_prob}%`,
              highlighted_player_ids: prev.players.filter((p) => p.is_modified).map((p) => p.player_id),
            },
            {
              message_id: `msg-${Date.now()}-2`,
              agent_role: "classic_coach",
              agent_name: "Míster Bianchi (Entrenador Clásico)",
              avatar_badge: "PRO-COACH",
              timestamp_label: `${prev.minute}:${String(prev.second).padStart(2, "0")} [SIMULACIÓN]`,
              headline: isUp
                ? "Buena fijación, pero atención a la cobertura del pivote"
                : "Perfilación correcta, pero regalas el carril interior",
              analysis_body: isUp
                ? "Generamos superioridad por fuera, pero no nos descuidemos atrás si hay pérdida en tres cuartos."
                : "Tapas la banda pero dejas un latigazo por el medio. Hay que bascular más rápido.",
              referenced_metric: "Intervalo Defensivo Modificado",
              highlighted_player_ids: prev.players.filter((p) => p.is_actor || p.is_modified).map((p) => p.player_id),
            },
          ],
        }));
      }, 500);
    }
  }, [currentFrame]);

  // Restablecer al frame base
  const resetSimulation = useCallback(() => {
    setCurrentFrame(sampleMockFrame as MatchFramePayload);
    setIsThinking(false);
    setHighlightedPlayerIds([]);
  }, []);

  return {
    currentFrame,
    isConnected,
    isThinking,
    highlightedPlayerIds,
    setHighlightedPlayerIds,
    updatePlayerPosition,
    triggerSimulation,
    resetSimulation,
  };
};

export default useMatchSocket;
