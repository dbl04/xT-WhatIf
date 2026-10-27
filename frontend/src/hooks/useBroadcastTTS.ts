"use strict";
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AgentMessage } from "@/types/match";
import { API_BASE_URL } from "@/lib/api";
import { Audience, DEFAULT_AUDIENCE, DEFAULT_LANGUAGE, Language, LOCALES } from "@/lib/i18n";
import { useSfxMuted } from "@/lib/sfx";

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

/** Backend TTS timeout (7 s by default) plus network and encoding slack. */
const TTS_REQUEST_TIMEOUT_MS = 9000;

/**
 * Best browser voice for a language and pundit role: neural/"Natural"/"Online" voices (Edge,
 * Chrome's Google voices) sound far less robotic than the first local voice for the locale, and
 * when two or more matching voices exist we assign distinct voices to Dr. Voronoi and Coach Bianchi.
 */
function pickVoice(
  voices: SpeechSynthesisVoice[],
  language: Language,
  role: AgentMessage["agent_role"] = "data_scientist"
): SpeechSynthesisVoice | null {
  const locale = LOCALES[language];
  const forLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(language));
  const isNeural = (v: SpeechSynthesisVoice) => /natural|neural|online|google/i.test(v.name);
  const neuralLocale = forLanguage.filter((v) => v.lang === locale && isNeural(v));
  const neuralAny = forLanguage.filter(isNeural);
  const localePool = forLanguage.filter((v) => v.lang === locale);
  const pool =
    neuralLocale.length > 0
      ? neuralLocale
      : neuralAny.length > 0
        ? neuralAny
        : localePool.length > 0
          ? localePool
          : forLanguage;
  if (pool.length === 0) return null;
  if (role === "classic_coach" && pool.length > 1) {
    return pool[1];
  }
  return pool[0];
}

function normalizeSpokenText(raw: string, language: Language): string {
  const deltaWord = language === "es" ? "delta equis te" : "delta x T";
  const xtWord = language === "es" ? "equis te" : "x T";
  return raw
    .replace(/ΔxT/g, deltaWord)
    .replace(/\bxT\b/g, xtWord)
    .replace(/\s+/g, " ")
    .trim();
}

export function useBroadcastTTS({
  messages,
  language = DEFAULT_LANGUAGE,
  audience = DEFAULT_AUDIENCE,
  autoPlayOnNewSimulation = false,
  onActiveSpeakerChange,
}: UseBroadcastTTSOptions) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useSfxMuted();
  const [activeSpeaker, setActiveSpeaker] = useState<
    "data_scientist" | "classic_coach" | null
  >(null);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number>(-1);

  const isPlayingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesRef = useRef<AgentMessage[]>(messages);
  /** Messages being played right now (the debate, or a list passed to playMessages) and their audio. */
  const queueRef = useRef<{ msg: AgentMessage; audio: Promise<string | null> }[]>([]);
  /** Bumped by stopAll: a playback loop from an earlier session must not carry on. */
  const sessionRef = useRef<number>(0);
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
    sessionRef.current += 1;

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

  // When the user toggles the header mute button on, immediately silence any active voice.
  useEffect(() => {
    if (isMuted) {
      stopAll();
    }
  }, [isMuted, stopAll]);

  const speakWithWebSpeech = useCallback(
    (msg: AgentMessage): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          resolve();
          return;
        }

        const { language: lang, audience: aud } = profileRef.current;
        const spokenText = normalizeSpokenText(msg.analysis_body || msg.headline, lang);
        const utterance = new SpeechSynthesisUtterance(spokenText);
        utterance.lang = LOCALES[lang];
        const voice = pickVoice(window.speechSynthesis.getVoices(), lang, msg.agent_role);
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

  /**
   * Azure OpenAI voice for one message from the backend (/tts/synthesize), as base64 MP3; null
   * when the backend has no TTS deployment, fails or times out (the browser voice reads it then).
   */
  const fetchAudio = useCallback(
    async (msg: AgentMessage): Promise<string | null> => {
      const role = msg.agent_role === "data_scientist" ? "data_scientist" : "classic_coach";
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/tts/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: (msg.analysis_body || msg.headline).slice(0, 1200),
            agent_role: role,
            language: profileRef.current.language,
            audience: profileRef.current.audience,
          }),
          // The backend waits up to AZURE_OPENAI_TTS_TIMEOUT_S (7 s) for Azure: give it that
          // plus the round trip, or the OpenAI voice is aborted before it arrives.
          signal: AbortSignal.timeout(TTS_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn("[TTS] synthesize failed:", res.status);
          return null;
        }
        const data = await res.json();
        if (data.is_fallback && data.warning) console.warn("[TTS]", data.warning);
        return data.audio_base64 ?? null;
      } catch (err) {
        console.warn("[TTS] synthesize request failed:", err);
        return null;
      }
    },
    []
  );

  /** Plays the message's OpenAI audio once it arrives, or reads it with the browser voice. */
  const speakMessage = useCallback(
    async (msg: AgentMessage, audioPromise: Promise<string | null>, session: number) => {
      const audioBase64 = await audioPromise;
      if (session !== sessionRef.current || isMutedRef.current) return;
      let handledWithAudio = false;
      if (audioBase64) {
        const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
        currentAudioRef.current = audio;
        handledWithAudio = await new Promise<boolean>((resolve) => {
          audio.onended = () => resolve(true);
          audio.onerror = () => resolve(false);
          audio.play().catch((err) => {
            console.warn("[TTS] OpenAI audio could not play:", err);
            resolve(false);
          });
        });
      }
      if (!handledWithAudio && session === sessionRef.current && !isMutedRef.current) {
        await speakWithWebSpeech(msg);
      }
    },
    [speakWithWebSpeech]
  );

  const playMessageIndex = useCallback(
    async (index: number, session: number) => {
      if (session !== sessionRef.current || isMutedRef.current) return;
      const queue = queueRef.current;
      if (index >= queue.length) {
        stopAll();
        return;
      }

      const { msg, audio } = queue[index];
      setActiveMessageIndex(index);
      const role =
        msg.agent_role === "data_scientist" ? "data_scientist" : "classic_coach";
      setActiveSpeaker(role);

      onActiveSpeakerChangeRef.current?.(role, msg.highlighted_player_ids || []);

      try {
        await speakMessage(msg, audio, session);
      } catch {
        // ignore errors to preserve continuity
      }

      if (session !== sessionRef.current || isMutedRef.current) return;

      // 350ms dramatic pause between speakers
      pauseTimeoutRef.current = setTimeout(() => playMessageIndex(index + 1, session), 350);
    },
    [speakMessage, stopAll]
  );

  /**
   * Plays a list of messages in order, interrupting anything playing. Every message's audio is
   * requested at once, so the next speaker is ready when the current one finishes; `audio` can
   * hand in audio already on its way (e.g. the live reveal, synthesised while the moment was open).
   */
  const playMessages = useCallback(
    (msgs: AgentMessage[], audio: (Promise<string | null> | undefined)[] = []) => {
      if (!msgs.length) return;
      stopAll();
      if (isMutedRef.current) return;
      const session = sessionRef.current;
      queueRef.current = msgs.map((msg, i) => ({ msg, audio: audio[i] ?? fetchAudio(msg) }));
      isPlayingRef.current = true;
      setIsPlaying(true);
      playMessageIndex(0, session);
    },
    [fetchAudio, playMessageIndex, stopAll]
  );

  const playSingleMessage = useCallback((msg: AgentMessage) => playMessages([msg]), [playMessages]);

  const play = useCallback(() => {
    playMessages(messagesRef.current);
  }, [playMessages]);

  const pause = useCallback(() => {
    stopAll();
  }, [stopAll]);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    setIsMuted(next);
    if (next) {
      stopAll();
    }
  }, [setIsMuted, stopAll]);

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
    playMessages,
    playSingleMessage,
    pause,
    stop: stopAll,
    toggleMute,
  };
}
