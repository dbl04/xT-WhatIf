"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MatchFramePayload,
  PlayerNode,
  CounterfactualRequest,
} from "@/types/match";
import syntheticMatchFrames from "@/mocks/match_900001_frames.json";
import { DEFAULT_MATCH_ID } from "@/lib/match";
import { API_BASE_URL, WS_BASE_URL } from "@/lib/api";
import { Audience, DEFAULT_AUDIENCE, DEFAULT_LANGUAGE, Language } from "@/lib/i18n";
import { localizeOfflineFrame, offlineCounterfactualDebate } from "@/lib/offlineNarration";
import { offsideLine } from "@/lib/challenge";
import { xtAt } from "@/lib/xt";

// Key moments of the synthetic match; same file the backend generates
// (backend/app/data/cache/match_900001_frames.json, see synthetic_generator.py)
export const DEFAULT_OFFLINE_FRAMES: MatchFramePayload[] =
  syntheticMatchFrames as MatchFramePayload[];

export interface UseMatchEngineOptions {
  matchId?: number;
  apiUrl?: string;
  wsUrl?: string;
  /** Narration profile: the backend writes labels and the pundits' debate for it. */
  language?: Language;
  audience?: Audience;
  /** Called whenever a counterfactual move simulation finishes so commentators can speak about it. */
  onSimulationComplete?: (frame: MatchFramePayload) => void;
}

export type ConnectionMode = "live" | "offline";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Pass completion 0-1 with the backend's interception cone (calculate_pass_probability_cone). */
function offlinePassProb(sx: number, sy: number, ex: number, ey: number, opponents: PlayerNode[]): number {
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.hypot(dx, dy);
  if (length < 1) return 0.96;
  let prob = Math.max(35, 96 - 0.72 * length);
  for (const o of opponents) {
    const t = ((o.x - sx) * dx + (o.y - sy) * dy) / length ** 2;
    if (t <= 0.05 || t >= 0.98) continue;
    const dPerp = Math.abs(dy * o.x - dx * o.y + ex * sy - ey * sx) / length;
    const sigma = 1.2 + 1.8 * t;
    const shadow = Math.exp(-(dPerp ** 2) / (2 * sigma ** 2));
    if (shadow >= 0.05) prob *= 1 - 0.65 * shadow;
  }
  return Math.max(5, Math.min(98, prob)) / 100;
}

/** Offline copy of the engine's best receiver: max P(pass) * xT over onside teammates. */
function offlineBestReceiver(frame: MatchFramePayload): number | null {
  const line = offsideLine(frame);
  const opponents = frame.players.filter((p) => p.team !== frame.possession_team);
  let best: { id: number; ev: number } | null = null;
  for (const p of frame.players) {
    if (p.team !== frame.possession_team || p.is_actor || p.is_keeper || p.x > line + 0.05) continue;
    const ev = offlinePassProb(frame.ball_x, frame.ball_y, p.x, p.y, opponents) * xtAt(p.x, p.y);
    if (!best || ev > best.ev) best = { id: p.player_id, ev };
  }
  return best?.id ?? null;
}

/**
 * New base frames for a profile change. Moments the user has already edited keep their
 * players and metrics; their debate is refreshed by re-simulating them.
 */
function mergeBaseFrames(prev: MatchFramePayload[], base: MatchFramePayload[]): MatchFramePayload[] {
  return base.map((frame) => {
    const edited = prev.find((p) => p.event_uuid === frame.event_uuid && p.is_counterfactual_mode);
    return edited ? { ...edited, moment_label: frame.moment_label } : frame;
  });
}

export function useMatchEngine({
  matchId = DEFAULT_MATCH_ID,
  apiUrl = API_BASE_URL,
  wsUrl = `${WS_BASE_URL}/ws`,
  language = DEFAULT_LANGUAGE,
  audience = DEFAULT_AUDIENCE,
  onSimulationComplete,
}: UseMatchEngineOptions = {}) {
  // Loaded frames and the active one
  const [frames, setFrames] = useState<MatchFramePayload[]>(DEFAULT_OFFLINE_FRAMES);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);

  // Connection and real-time state
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("offline");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);

  // Two-way highlight sync between pitch and pundits
  const [highlightedPlayerIds, setHighlightedPlayerIds] = useState<number[]>([]);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  // Internal references
  const baseFramesRef = useRef<MatchFramePayload[]>(DEFAULT_OFFLINE_FRAMES);
  const socketRef = useRef<WebSocket | null>(null);
  const framesRef = useRef<MatchFramePayload[]>(frames);
  const currentIndexRef = useRef<number>(currentFrameIndex);
  const profileRef = useRef({ language, audience });
  const connectionModeRef = useRef<ConnectionMode>(connectionMode);
  const resimulateRef = useRef<(players: PlayerNode[]) => void>(() => {});
  const onSimulationCompleteRef = useRef(onSimulationComplete);

  framesRef.current = frames;
  currentIndexRef.current = currentFrameIndex;
  profileRef.current = { language, audience };
  connectionModeRef.current = connectionMode;
  onSimulationCompleteRef.current = onSimulationComplete;

  // 1. Load frames for the current profile from GET /api/v1/match/{matchId}/frames.
  //    Without a backend, fall back to the bundled offline frames (same data, same narration).
  useEffect(() => {
    let isCancelled = false;

    const applyBase = (base: MatchFramePayload[]) => {
      baseFramesRef.current = clone(base);
      const merged = mergeBaseFrames(framesRef.current, base);
      setFrames(merged);
      // An edited moment keeps its players; ask the pundits again in the new profile.
      const active = merged[currentIndexRef.current];
      if (active?.is_counterfactual_mode) {
        resimulateRef.current(active.players.filter((p) => p.is_modified));
      }
    };

    async function loadFrames() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const query = new URLSearchParams({ lang: language, audience });

        const response = await fetch(`${apiUrl}/api/v1/match/${matchId}/frames?${query}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: MatchFramePayload[] = await response.json();
        if (!isCancelled && Array.isArray(data) && data.length > 0) {
          setConnectionMode("live");
          connectionModeRef.current = "live";
          setIsConnected(true);
          applyBase(data);
        }
      } catch (err) {
        if (!isCancelled) {
          // Quiet, graceful fallback to the offline demo mode
          console.info("FastAPI backend unavailable. Switching to OFFLINE DEMO MODE with bundled data.", err);
          setConnectionMode("offline");
          connectionModeRef.current = "offline";
          setIsConnected(false);
          applyBase(DEFAULT_OFFLINE_FRAMES.map((f) => localizeOfflineFrame(f, language, audience)));
        }
      }
    }

    loadFrames();

    return () => {
      isCancelled = true;
    };
  }, [apiUrl, matchId, language, audience]);

  // 2. Two-way WebSocket when the backend is available (frames arrive in the current profile).
  useEffect(() => {
    const query = new URLSearchParams({ lang: language, audience });
    const fullWsUrl = `${wsUrl}/match/${matchId}?${query}`;
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
          if (message.type === "INITIAL_FRAME") {
            // Frames already come from the REST call; the handshake frame is informative only.
            setIsThinking(false);
          } else if (message.type === "FRAME_UPDATE" && message.payload) {
            setFrames((prev) => {
              const updated = [...prev];
              const targetIdx = updated.findIndex((f) => f.event_uuid === message.payload.event_uuid);
              if (targetIdx !== -1 && !updated[targetIdx].is_counterfactual_mode) {
                updated[targetIdx] = message.payload;
              }
              return updated;
            });
            setIsThinking(false);
          } else if (message.type === "SIMULATION_ERROR") {
            // Rate-limited or rejected by the backend: stop waiting for a result.
            console.warn("Simulation rejected by backend:", message.reason);
            setIsThinking(false);
          } else if (message.type === "SIMULATION_UPDATE" && message.payload) {
            setFrames((prev) => {
              const updated = [...prev];
              const idx = updated.findIndex((f) => f.event_uuid === message.payload.event_uuid);
              updated[idx !== -1 ? idx : currentIndexRef.current] = message.payload;
              return updated;
            });
            setIsThinking(false);
            onSimulationCompleteRef.current?.(message.payload);
          }
        } catch (e) {
          console.error("Error handling WebSocket message:", e);
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
  }, [wsUrl, matchId, language, audience]);

  // Active frame
  const currentFrame =
    frames[currentFrameIndex] ||
    frames[0] ||
    (DEFAULT_OFFLINE_FRAMES[0] as MatchFramePayload);

  // 3. Update a player's position (canonical 120x80 coordinates)
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

        // Mark the frame as counterfactual straight away
        active.is_counterfactual_mode = true;
        nextFrames[currentFrameIndex] = active;
        return nextFrames;
      });
    },
    [currentFrameIndex]
  );

  // Apply a pre-computed simulated frame (e.g. from /api/v1/agents/what-if voice input)
  const applySimulatedFrame = useCallback((simulated: MatchFramePayload) => {
    setFrames((prev) => {
      const next = [...prev];
      const idx = next.findIndex((f) => f.event_uuid === simulated.event_uuid);
      next[idx !== -1 ? idx : currentIndexRef.current] = simulated;
      return next;
    });
    setIsThinking(false);
    onSimulationCompleteRef.current?.(simulated);
  }, []);

  // 4. Run the counterfactual simulation (onPlayerDrop)
  const triggerSimulation = useCallback(
    async (customPlayers?: PlayerNode[]) => {
      const frameIndex = currentIndexRef.current;
      const activeFrame = framesRef.current[frameIndex];
      const { language: lang, audience: aud } = profileRef.current;
      // Only send players the user actually moved: the backend flags every player it
      // receives as is_modified, so sending the full roster marked all 22 as moved.
      // Callers that move players and simulate in the same tick must pass them in
      // customPlayers, because `frames` here does not yet include that move.
      const playersToSimulate = (customPlayers || activeFrame.players).filter((p) => p.is_modified);

      // Nothing moved (e.g. a click on a player without dragging): nothing to recalculate.
      if (playersToSimulate.length === 0) return;

      setIsThinking(true);

      const requestPayload: CounterfactualRequest = {
        match_id: activeFrame.match_id,
        event_uuid: activeFrame.event_uuid,
        modified_players: playersToSimulate,
        language: lang,
        audience: aud,
      };

      // Prefer the open WebSocket
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "SIMULATE_MOVE",
            payload: requestPayload,
          })
        );
        return;
      }

      // LIVE backend without WebSocket: POST /api/v1/simulate
      if (connectionModeRef.current === "live") {
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
              next[frameIndex] = simulated;
              return next;
            });
            setIsThinking(false);
            onSimulationCompleteRef.current?.(simulated);
            return;
          }
        } catch (e) {
          console.warn("POST /api/v1/simulate failed, falling back to offline simulation:", e);
        }
      }

      // Offline mode: instant heuristic xT estimate and pundit debate
      setTimeout(() => {
        let computedFrame: MatchFramePayload | null = null;
        setFrames((prev) => {
          const next = [...prev];
          const frame = { ...next[frameIndex] };
          const modified = frame.players.filter((p) => p.is_modified);
          const actor = frame.players.find((p) => p.is_actor) || frame.players[0];

          // Distance from the ball carrier to the opponent's goal (120.0, 40.0)
          const distToGoal = Math.hypot(120.0 - actor.x, 40.0 - actor.y);
          const baseThreat = Math.max(0.05, Math.min(0.95, 0.75 - (distToGoal / 120.0) * 0.6));

          // Effect of the moved defenders
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

          // Controlled space
          const spaceControl = Math.max(
            15.0,
            Math.min(85.0, Number((frame.metrics.space_control_home_pct + (isUp ? 8 : -14)).toFixed(1)))
          );

          // Pass probability
          const passProb = Math.max(
            10.0,
            Math.min(95.0, Number((frame.metrics.pass_completion_prob + (isUp ? 12 : -22)).toFixed(1)))
          );

          // Alternative best target
          const optimalTarget = offlineBestReceiver(frame) ?? frame.metrics.optimal_pass_target_id;

          frame.is_counterfactual_mode = true;
          frame.metrics = {
            ...frame.metrics,
            simulated_xt: simXt,
            xt_delta: delta,
            space_control_home_pct: spaceControl,
            pass_completion_prob: passProb,
            optimal_pass_target_id: optimalTarget,
          };

          frame.agent_debate = offlineCounterfactualDebate(frame, lang, {
            modifiedNames: modified.map((m) => m.name).join(", "),
            modifiedIds: modified.map((m) => m.player_id),
            actorId: actor.player_id,
            delta,
            simXt,
            passProb,
          });

          computedFrame = frame;
          next[frameIndex] = frame;
          return next;
        });

        setIsThinking(false);
        if (computedFrame) {
          onSimulationCompleteRef.current?.(computedFrame);
        }
      }, 450);
    },
    [apiUrl]
  );

  resimulateRef.current = (players: PlayerNode[]) => {
    void triggerSimulation(players);
  };

  // Handler for when the user drops a dragged player
  const onPlayerDrop = useCallback(
    (_playerId: number) => {
      triggerSimulation();
    },
    [triggerSimulation]
  );

  // 5. Reset to the selected moment's original base frame
  const resetSimulation = useCallback(() => {
    const base = baseFramesRef.current[currentFrameIndex] || DEFAULT_OFFLINE_FRAMES[currentFrameIndex];
    setFrames((prev) => {
      const next = [...prev];
      next[currentFrameIndex] = clone(base);
      return next;
    });
    setIsThinking(false);
    setHighlightedPlayerIds([]);
    setHoveredPlayerId(null);
  }, [currentFrameIndex]);

  // 6. Switch key moment
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
    highlightedPlayerIds,
    setHighlightedPlayerIds,
    hoveredPlayerId,
    setHoveredPlayerId,
    selectFrameIndex,
    updatePlayerPosition,
    applySimulatedFrame,
    onPlayerDrop,
    triggerSimulation,
    resetSimulation,
  };
}

export default useMatchEngine;
