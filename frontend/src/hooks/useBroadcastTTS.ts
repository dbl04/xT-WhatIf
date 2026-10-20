"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AgentMessage } from "@/types/match";

export interface UseBroadcastTTSOptions {
  messages: AgentMessage[];
  autoPlayOnNewSimulation?: boolean;
  onActiveSpeakerChange?: (
    role: "data_scientist" | "classic_coach" | null,
    highlightedPlayerIds: number[]
  ) => void;
}

export function useBroadcastTTS({
  messages,
  autoPlayOnNewSimulation = false,
  onActiveSpeakerChange,
}: UseBroadcastTTSOptions) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [activeSpeaker, setActiveSpeaker] = useState<
    "data_scientist" | "classic_coach" | null
  >(null);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number>(-1);

  const isPlayingRef = useRef<boolean>(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesRef = useRef<AgentMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const stopAll = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setActiveSpeaker(null);
    setActiveMessageIndex(-1);

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    if (onActiveSpeakerChange) {
      onActiveSpeakerChange(null, []);
    }
  }, [onActiveSpeakerChange]);

  const speakWithWebSpeech = useCallback(
    (msg: AgentMessage): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          resolve();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(msg.analysis_body || msg.headline);
        const voices = window.speechSynthesis.getVoices();
        const esVoice =
          voices.find((v) => v.lang.startsWith("es-AR")) ||
          voices.find((v) => v.lang.startsWith("es-ES")) ||
          voices.find((v) => v.lang.startsWith("es")) ||
          null;

        if (esVoice) {
          utterance.voice = esVoice;
        }

        const isVoronoi = msg.agent_role === "data_scientist";
        utterance.pitch = isVoronoi ? 1.08 : 0.88;
        utterance.rate = isVoronoi ? 1.12 : 1.02;

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.speak(utterance);
      });
    },
    []
  );

  const playMessageIndex = useCallback(
    async (index: number) => {
      const msgs = messagesRef.current;
      if (!isPlayingRef.current || index >= msgs.length) {
        stopAll();
        return;
      }

      const msg = msgs[index];
      setActiveMessageIndex(index);
      const role =
        msg.agent_role === "data_scientist" ? "data_scientist" : "classic_coach";
      setActiveSpeaker(role);

      if (onActiveSpeakerChange) {
        onActiveSpeakerChange(role, msg.highlighted_player_ids || []);
      }

      try {
        // First try backend synthesize endpoint with fast timeout
        let handledWithAudio = false;
        try {
          const res = await fetch("/api/v1/tts/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: msg.analysis_body || msg.headline,
              agent_role: role,
            }),
            signal: AbortSignal.timeout(1200),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.audio_base64) {
              const audio = new Audio(`data:audio/mp3;base64,${data.audio_base64}`);
              currentAudioRef.current = audio;
              await new Promise<void>((resolve) => {
                audio.onended = () => resolve();
                audio.onerror = () => resolve();
                audio.play().catch(() => resolve());
              });
              handledWithAudio = true;
            }
          }
        } catch {
          handledWithAudio = false;
        }

        // Zero-latency browser Web Speech fallback
        if (!handledWithAudio && isPlayingRef.current) {
          await speakWithWebSpeech(msg);
        }
      } catch {
        // ignore errors to preserve continuity
      }

      if (!isPlayingRef.current) return;

      // 350ms dramatic pause between speakers
      pauseTimeoutRef.current = setTimeout(() => {
        if (isPlayingRef.current) {
          playMessageIndex(index + 1);
        }
      }, 350);
    },
    [onActiveSpeakerChange, speakWithWebSpeech, stopAll]
  );

  const playSingleMessage = useCallback(
    async (msg: AgentMessage) => {
      stopAll();
      isPlayingRef.current = true;
      setIsPlaying(true);
      const role =
        msg.agent_role === "data_scientist" ? "data_scientist" : "classic_coach";
      setActiveSpeaker(role);
      if (onActiveSpeakerChange) {
        onActiveSpeakerChange(role, msg.highlighted_player_ids || []);
      }
      try {
        await speakWithWebSpeech(msg);
      } finally {
        stopAll();
      }
    },
    [onActiveSpeakerChange, speakWithWebSpeech, stopAll]
  );

  const play = useCallback(() => {
    if (!messages.length) return;
    stopAll();
    isPlayingRef.current = true;
    setIsPlaying(true);
    playMessageIndex(0);
  }, [messages.length, playMessageIndex, stopAll]);

  const pause = useCallback(() => {
    stopAll();
  }, [stopAll]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        stopAll();
      }
      return next;
    });
  }, [stopAll]);

  // Handle auto-play on new simulation if enabled
  useEffect(() => {
    if (autoPlayOnNewSimulation && messages.length > 0) {
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, autoPlayOnNewSimulation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  return {
    isPlaying,
    isMuted,
    activeSpeaker,
    activeMessageIndex,
    play,
    playSingleMessage,
    pause,
    stop: stopAll,
    toggleMute,
  };
}
