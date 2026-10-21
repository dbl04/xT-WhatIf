"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AgentMessage } from "@/types/match";
import { API_BASE_URL } from "@/lib/api";
import { Audience, DEFAULT_AUDIENCE, DEFAULT_LANGUAGE, Language, LOCALES } from "@/lib/i18n";

export interface UseBroadcastTTSOptions {
  messages: AgentMessage[];
  /** Language the pundits speak; audio description is read a little slower. */
  language?: Language;
  audience?: Audience;
  autoPlayOnNewSimulation?: boolean;
  onActiveSpeakerChange?: (
    role: "data_scientist" | "classic_coach" | null,
    highlightedPlayerIds: number[]
  ) => void;
}

/**
 * Best browser voice for a language: neural/"Natural"/"Online" voices (Edge, Chrome's Google
 * voices) sound far less robotic than the first local voice for the locale.
 */
function pickVoice(voices: SpeechSynthesisVoice[], language: Language): SpeechSynthesisVoice | null {
  const locale = LOCALES[language];
  const forLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(language));
  const isNeural = (v: SpeechSynthesisVoice) => /natural|neural|online|google/i.test(v.name);
  return (
    forLanguage.find((v) => v.lang === locale && isNeural(v)) ||
    forLanguage.find(isNeural) ||
    forLanguage.find((v) => v.lang === locale) ||
    forLanguage[0] ||
    null
  );
}

export function useBroadcastTTS({
  messages,
  language = DEFAULT_LANGUAGE,
  audience = DEFAULT_AUDIENCE,
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
  const onActiveSpeakerChangeRef = useRef(onActiveSpeakerChange);
  const profileRef = useRef({ language, audience });
  profileRef.current = { language, audience };

  // Keep refs up-to-date without triggering re-render loops
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    onActiveSpeakerChangeRef.current = onActiveSpeakerChange;
  }, [onActiveSpeakerChange]);

  const stopAll = useCallback(() => {
    const wasPlaying = isPlayingRef.current;
    isPlayingRef.current = false;

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

    // Use functional state updates to avoid unnecessary renders if already false/null
    setIsPlaying((prev) => (prev ? false : prev));
    setActiveSpeaker((prev) => (prev !== null ? null : prev));
    setActiveMessageIndex((prev) => (prev !== -1 ? -1 : prev));

    if (wasPlaying) {
      onActiveSpeakerChangeRef.current?.(null, []);
    }
  }, []);

  const speakWithWebSpeech = useCallback(
    (msg: AgentMessage): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          resolve();
          return;
        }

        const { language: lang, audience: aud } = profileRef.current;
        const utterance = new SpeechSynthesisUtterance(msg.analysis_body || msg.headline);
        utterance.lang = LOCALES[lang];
        const voice = pickVoice(window.speechSynthesis.getVoices(), lang);
        if (voice) {
          utterance.voice = voice;
        }

        const isVoronoi = msg.agent_role === "data_scientist";
        const slowDown = aud === "audio_description" ? 0.9 : 1;
        utterance.pitch = isVoronoi ? 1.08 : 0.88;
        utterance.rate = (isVoronoi ? 1.12 : 1.02) * slowDown;

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

      onActiveSpeakerChangeRef.current?.(role, msg.highlighted_player_ids || []);

      try {
        // First try backend synthesize endpoint with fast timeout
        let handledWithAudio = false;
        try {
          const res = await fetch(`${API_BASE_URL}/api/v1/tts/synthesize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: msg.analysis_body || msg.headline,
              agent_role: role,
              language: profileRef.current.language,
              audience: profileRef.current.audience,
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
    [speakWithWebSpeech, stopAll]
  );

  const playSingleMessage = useCallback(
    async (msg: AgentMessage) => {
      stopAll();
      isPlayingRef.current = true;
      setIsPlaying(true);
      const role =
        msg.agent_role === "data_scientist" ? "data_scientist" : "classic_coach";
      setActiveSpeaker(role);
      onActiveSpeakerChangeRef.current?.(role, msg.highlighted_player_ids || []);

      try {
        await speakWithWebSpeech(msg);
      } finally {
        stopAll();
      }
    },
    [speakWithWebSpeech, stopAll]
  );

  const play = useCallback(() => {
    if (!messagesRef.current.length) return;
    stopAll();
    isPlayingRef.current = true;
    setIsPlaying(true);
    playMessageIndex(0);
  }, [playMessageIndex, stopAll]);

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

  // A new language or audience means new commentary: silence the old one.
  useEffect(() => {
    stopAll();
  }, [language, audience, stopAll]);

  // Clean unmount ONLY (stopAll is completely stable with [] dependencies)
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
