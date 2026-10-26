"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AgentMessage } from "@/types/match";
import { API_BASE_URL } from "@/lib/api";
import { Audience, DEFAULT_AUDIENCE, DEFAULT_LANGUAGE, LOCALES, Language } from "@/lib/i18n";

export interface UseBroadcastTTSOptions {
  messages: AgentMessage[];
  onActiveSpeakerChange?: (
    role: "data_scientist" | "classic_coach" | null,
    highlightedIds: number[]
  ) => void;
  language?: Language;
  audience?: Audience;
}

/**
 * Normalizes mathematical/tactical notation so TTS engines pronounce it naturally.
 */
function normalizeTextForSpeech(text: string, lang: Language): string {
  let out = text
    .replace(/ΔxT/g, lang === "es" ? "diferencia de xT" : "delta xT")
    .replace(/xT/g, "x T")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Scores a browser SpeechSynthesisVoice so neural/natural voices (Edge Online Natural,
 * Google, Apple Enhanced) are strongly preferred over legacy robotic SAPI5 voices.
 */
function scoreVoice(v: SpeechSynthesisVoice, langPrefix: string, preferredLocale: string): number {
  const vLang = v.lang.toLowerCase().replace("_", "-");
  if (!vLang.startsWith(langPrefix)) return -1;
  let score = 10;
  if (vLang === preferredLocale.toLowerCase()) score += 15;
  const name = v.name.toLowerCase();
  if (name.includes("natural") || name.includes("neural") || name.includes("online")) score += 50;
  else if (name.includes("google") || name.includes("premium") || name.includes("enhanced") || name.includes("siri")) score += 30;
  if (!v.localService) score += 10;
  return score;
}

/**
 * Picks two distinct, high-quality voices in the current language for the two pundits.
 */
function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: Language,
  role: AgentMessage["agent_role"]
): SpeechSynthesisVoice | null {
  const prefix = lang.toLowerCase();
  const preferredLocale = LOCALES[lang];
  const matching = voices
    .filter((v) => scoreVoice(v, prefix, preferredLocale) >= 0)
    .sort((a, b) => scoreVoice(b, prefix, preferredLocale) - scoreVoice(a, prefix, preferredLocale));

  if (matching.length === 0) return null;

  // Prefer male/analytical vs deeper/coach voice hints when available among top voices
  const top = matching.slice(0, Math.min(matching.length, 6));
  const dsHints = ["alvaro", "jorge", "pablo", "dario", "daniel", "ryan", "guy", "arthur", "google uk english male", "male"];
  const coachHints = ["alonso", "tomas", "enrique", "anton", "christopher", "eric", "george", "oliver", "david", "mark"];

  const findByHints = (hints: string[], exclude?: SpeechSynthesisVoice | null) =>
    top.find((v) => v !== exclude && hints.some((h) => v.name.toLowerCase().includes(h))) ?? null;

  const dsVoice = findByHints(dsHints) ?? matching[0];
  if (role === "data_scientist") {
    return dsVoice;
  }

  const coachVoice =
    findByHints(coachHints, dsVoice) ??
    matching.find((v) => v !== dsVoice) ??
    matching[0];
  return coachVoice;
}

/**
 * Ensures browser voices are loaded (Chrome/Edge load them asynchronously via `voiceschanged`).
 */
function getLoadedVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      resolve(window.speechSynthesis.getVoices());
    };
    const onVoices = () => finish();
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    setTimeout(finish, 450);
  });
}

export function useBroadcastTTS({
  messages,
  onActiveSpeakerChange,
  language = DEFAULT_LANGUAGE,
  audience = DEFAULT_AUDIENCE,
}: UseBroadcastTTSOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<"data_scientist" | "classic_coach" | null>(null);
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number>(0);
  const [ttsWarning, setTtsWarning] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const abortRef = useRef<boolean>(false);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const profileRef = useRef({ language, audience });
  profileRef.current = { language, audience };

  const onSpeakerChangeRef = useRef(onActiveSpeakerChange);
  useEffect(() => {
    onSpeakerChangeRef.current = onActiveSpeakerChange;
  }, [onActiveSpeakerChange]);

  // Warm up browser voices on mount so the first click never gets an empty voice list
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Stop any playing audio
  const stop = useCallback(() => {
    abortRef.current = true;
    setIsPlaying(false);
    setActiveSpeaker(null);
    onSpeakerChangeRef.current?.(null, []);

    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    utteranceRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // Speak a single message using Web Speech API fallback
  const speakWithWebSpeech = useCallback((msg: AgentMessage): Promise<void> => {
    return new Promise(async (resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setTimeout(resolve, 1500);
        return;
      }

      const voices = await getLoadedVoices();
      if (abortRef.current) {
        resolve();
        return;
      }

      const lang = profileRef.current.language;
      const spokenText = normalizeTextForSpeech(
        msg.headline ? `${msg.headline}. ${msg.analysis_body}` : msg.analysis_body,
        lang
      );
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utteranceRef.current = utterance;
      utterance.lang = LOCALES[lang];

      const preferredVoice = pickVoice(voices, lang, msg.agent_role);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      const isAudioDescription = profileRef.current.audience === "audio_description";
      if (msg.agent_role === "data_scientist") {
        // Dr. Voronoi: clear, analytical cadence
        utterance.pitch = 1.04;
        utterance.rate = isAudioDescription ? 0.98 : 1.03;
      } else {
        // Coach Bianchi: deeper, authoritative dressing-room cadence
        utterance.pitch = 0.88;
        utterance.rate = isAudioDescription ? 0.94 : 0.97;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      // Small delay after any previous `cancel()` prevents Chromium from dropping the utterance
      setTimeout(() => {
        if (abortRef.current) {
          finish();
          return;
        }
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          window.speechSynthesis.speak(utterance);
        } catch {
          finish();
        }
      }, 60);
    });
  }, []);

  // Play base64 MP3 helper
  const playBase64Audio = useCallback((base64Data: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const audio = new Audio(`data:audio/mp3;base64,${base64Data}`);
      audioRef.current = audio;
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
  }, []);

  // Synthesize via FastAPI Azure OpenAI TTS (`gpt-4o-mini-tts`) or fallback to Web Speech API
  const synthesizeAndPlay = useCallback(
    async (msg: AgentMessage): Promise<void> => {
      if (abortRef.current) return;

      setActiveSpeaker(msg.agent_role);
      onSpeakerChangeRef.current?.(msg.agent_role, msg.highlighted_player_ids || []);

      const lang = profileRef.current.language;
      const aud = profileRef.current.audience;
      const cacheKey = `${msg.message_id || msg.agent_role}:${lang}:${aud}:${msg.analysis_body.slice(0, 64)}`;

      const cachedBase64 = audioCacheRef.current.get(cacheKey);
      if (cachedBase64) {
        const played = await playBase64Audio(cachedBase64);
        if (played || abortRef.current) return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/tts/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: msg.headline ? `${msg.headline}. ${msg.analysis_body}` : msg.analysis_body,
            agent_role: msg.agent_role,
            language: lang,
            audience: aud,
          }),
          // Allow up to 8.5s to match the backend's 7s Azure OpenAI TTS timeout
          signal: AbortSignal.timeout(8500),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.warning || data.fallback_warning) {
            const warnMsg = data.warning || data.fallback_warning;
            setTtsWarning(warnMsg);
            console.warn("[xT-WhatIf TTS]", warnMsg);
          } else {
            setTtsWarning(null);
          }

          if (data.status === "synthesized" && data.audio_base64 && !abortRef.current) {
            audioCacheRef.current.set(cacheKey, data.audio_base64);
            const played = await playBase64Audio(data.audio_base64);
            if (played) return;
          }
        }
      } catch {
        // Backend offline or timed out: fall back cleanly to browser Web Speech API
      }

      if (!abortRef.current) {
        await speakWithWebSpeech(msg);
      }
    },
    [playBase64Audio, speakWithWebSpeech]
  );

  // Play all messages sequentially
  const play = useCallback(async () => {
    if (!messages || messages.length === 0) return;

    stop();
    abortRef.current = false;
    setIsPlaying(true);

    for (let i = 0; i < messages.length; i++) {
      if (abortRef.current) break;
      setCurrentMessageIndex(i);
      await synthesizeAndPlay(messages[i]);
    }

    if (!abortRef.current) {
      setIsPlaying(false);
      setActiveSpeaker(null);
      onSpeakerChangeRef.current?.(null, []);
    }
  }, [messages, stop, synthesizeAndPlay]);

  // Play a single specific message (uses Azure TTS first, then Web Speech fallback)
  const playSingleMessage = useCallback(
    async (msg: AgentMessage) => {
      stop();
      abortRef.current = false;
      setIsPlaying(true);
      await synthesizeAndPlay(msg);
      if (!abortRef.current) {
        setIsPlaying(false);
        setActiveSpeaker(null);
        onSpeakerChangeRef.current?.(null, []);
      }
    },
    [stop, synthesizeAndPlay]
  );

  // Stop audio on unmount or when language/audience changes
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop, language, audience]);

  return {
    isPlaying,
    activeSpeaker,
    currentMessageIndex,
    ttsWarning,
    play,
    playSingleMessage,
    stop,
  };
}
