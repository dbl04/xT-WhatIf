"use strict";
"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { MatchFramePayload, PlayerNode } from "@/types/match";
import { LOCALES, useI18n } from "@/lib/i18n";
import {
  executeVoiceWhatIf,
  InterpretedVoiceMove,
  MAX_VOICE_MOVES,
  STTProvider,
  transcribeVoiceWithAzure,
} from "@/lib/voiceWhatIf";
import { Button, IconButton, Kicker } from "@/components/ui/primitives";
import { sfx } from "@/lib/sfx";
import {
  Mic,
  Square,
  Loader2,
  RotateCcw,
  Send,
  TriangleAlert,
  Cloud,
} from "lucide-react";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function getPreferredAudioMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/wav",
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "audio/webm";
}

export interface VoiceWhatIfPanelProps {
  currentFrame: MatchFramePayload;
  inPlayMode?: boolean;
  onEnterPlayMode?: () => void;
  onBeforeListen?: () => void;
  onMovePlayer: (playerId: number, x: number, y: number) => void;
  onApplySimulatedFrame: (simulatedFrame: MatchFramePayload) => void;
  onTriggerOfflineSimulation: (updatedPlayers: PlayerNode[]) => void;
  onHighlightPlayers: (playerIds: number[]) => void;
  onResetMoves: () => void;
  onDropMove?: () => void;
  movablePlayerIds?: number[];
  externalLimitNotice?: boolean;
}

const VOICE_MOVE_ANIM_MS = 650;

export const VoiceWhatIfPanel: React.FC<VoiceWhatIfPanelProps> = ({
  currentFrame,
  inPlayMode = false,
  onEnterPlayMode,
  onBeforeListen,
  onMovePlayer,
  onApplySimulatedFrame,
  onTriggerOfflineSimulation,
  onHighlightPlayers,
  onResetMoves,
  onDropMove,
  movablePlayerIds,
  externalLimitNotice = false,
}) => {
  const { language, audience, t } = useI18n();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [lastMoves, setLastMoves] = useState<InterpretedVoiceMove[]>([]);
  const [sttProvider, setSttProvider] = useState<STTProvider | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [micError, setMicError] = useState<"unsupported" | "error" | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const usingMediaRecorderRef = useRef<boolean>(false);
  const transcriptRef = useRef<string>("");
  const submittedOnEndRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRafRef = useRef<number>(0);
  const frameRef = useRef<MatchFramePayload>(currentFrame);
  frameRef.current = currentFrame;

  const movedCount = currentFrame.players.filter((p) => p.is_modified).length;

  const cleanupMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    usingMediaRecorderRef.current = false;
  }, []);

  useEffect(() => {
    if (externalLimitNotice) {
      setLimitReached(true);
    }
  }, [externalLimitNotice]);

  // Clear local notices and cancel in-flight animations when switching key moments or resetting the play
  useEffect(() => {
    if (animRafRef.current) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = 0;
    }
    if (!currentFrame.is_counterfactual_mode && !inPlayMode) {
      setLastMoves([]);
      setLastQuery(null);
      setLimitReached(false);
    }
  }, [currentFrame.event_uuid, currentFrame.is_counterfactual_mode, inPlayMode]);

  useEffect(() => {
    return () => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      recognitionRef.current?.abort();
      cleanupMediaStream();
    };
  }, [cleanupMediaStream]);

  const animateMovesOnPitch = useCallback(
    (moves: InterpretedVoiceMove[], activePlayers: PlayerNode[]): Promise<void> => {
      return new Promise((resolve) => {
        if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
        const startPositions = moves.map((mv) => {
          const current = activePlayers.find((p) => p.player_id === mv.player_id);
          return {
            playerId: mv.player_id,
            startX: current ? current.x : mv.from_x,
            startY: current ? current.y : mv.from_y,
            endX: mv.to_x,
            endY: mv.to_y,
          };
        });

        const t0 = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - t0) / VOICE_MOVE_ANIM_MS);
          // Smooth cubic ease-out so the player glides visibly across the pitch
          const eased = 1 - Math.pow(1 - progress, 3);
          for (const sp of startPositions) {
            const x = Number((sp.startX + (sp.endX - sp.startX) * eased).toFixed(1));
            const y = Number((sp.startY + (sp.endY - sp.startY) * eased).toFixed(1));
            onMovePlayer(sp.playerId, x, y);
          }
          if (progress < 1) {
            animRafRef.current = requestAnimationFrame(step);
          } else {
            animRafRef.current = 0;
            resolve();
          }
        };

        animRafRef.current = requestAnimationFrame(step);
      });
    },
    [onMovePlayer]
  );

  const runVoiceInstruction = useCallback(
    async (rawQuery: string, providerUsed?: STTProvider) => {
      const cleanQuery = rawQuery.trim();
      if (cleanQuery.length < 2) {
        setIsProcessing(false);
        return;
      }

      setIsProcessing(true);
      setLimitReached(false);
      setMicError(null);
      setLastQuery(cleanQuery);
      if (providerUsed) {
        setSttProvider(providerUsed);
      }

      const snapshotFrame = frameRef.current;
      const targetUuid = snapshotFrame.event_uuid;
      const result = await executeVoiceWhatIf(cleanQuery, snapshotFrame, language, audience, movablePlayerIds);

      // Abort if the user switched key moments while the backend was processing the voice command
      if (frameRef.current.event_uuid !== targetUuid) {
        setIsProcessing(false);
        return;
      }

      if (result.limitReached || result.moves.length === 0) {
        sfx.blocked();
        setLimitReached(true);
        setIsProcessing(false);
        return;
      }

      // Enter play mode (modo de jugada) because outside players cannot be moved!
      onEnterPlayMode?.();

      const movedIds = result.moves.map((m) => m.player_id);
      onHighlightPlayers(movedIds);

      // Animate players moving across the pitch according to the spoken instruction
      await animateMovesOnPitch(result.moves, snapshotFrame.players);

      // Abort if the user switched key moments during the 650ms pitch animation
      if (frameRef.current.event_uuid !== targetUuid) {
        setIsProcessing(false);
        return;
      }

      sfx.drop();
      onDropMove?.();
      setLastMoves(result.moves);

      if (result.simulatedFrame) {
        onApplySimulatedFrame(result.simulatedFrame);
      } else {
        const moveById = new Map(result.moves.map((m) => [m.player_id, m]));
        const updatedPlayers = snapshotFrame.players.map((p) => {
          const mv = moveById.get(p.player_id);
          if (!mv) return p;
          return {
            ...p,
            x: mv.to_x,
            y: mv.to_y,
            original_x: p.original_x ?? mv.from_x,
            original_y: p.original_y ?? mv.from_y,
            is_modified: true,
          };
        });
        onTriggerOfflineSimulation(updatedPlayers);
      }

      setTranscript("");
      transcriptRef.current = "";
      setIsProcessing(false);
    },
    [
      language,
      audience,
      movablePlayerIds,
      onEnterPlayMode,
      onHighlightPlayers,
      animateMovesOnPitch,
      onDropMove,
      onApplySimulatedFrame,
      onTriggerOfflineSimulation,
    ]
  );

  const processRecordedAudio = useCallback(
    async (audioBlob: Blob | null) => {
      const browserTranscript = transcriptRef.current.trim();
      setIsProcessing(true);

      if (audioBlob && audioBlob.size > 200) {
        const sttRes = await transcribeVoiceWithAzure(audioBlob, frameRef.current, language);
        if (sttRes.text.length >= 2) {
          setTranscript(sttRes.text);
          transcriptRef.current = sttRes.text;
          await runVoiceInstruction(sttRes.text, sttRes.provider);
          return;
        }
      }

      if (browserTranscript.length >= 2) {
        await runVoiceInstruction(browserTranscript, "browser-web-speech-fallback");
      } else {
        setIsProcessing(false);
      }
    },
    [language, runVoiceInstruction]
  );

  const startListening = async () => {
    const Ctor = getSpeechRecognitionCtor();
    const canMediaRecord =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";

    if (!Ctor && !canMediaRecord) {
      setMicError("unsupported");
      return;
    }

    onBeforeListen?.();
    setLimitReached(false);
    setMicError(null);
    setTranscript("");
    transcriptRef.current = "";
    submittedOnEndRef.current = false;
    audioChunksRef.current = [];
    usingMediaRecorderRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // 1. Start MediaRecorder for Azure AI Speech / Azure OpenAI Whisper cloud transcription
    if (canMediaRecord) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mimeType = getPreferredAudioMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };
        recorder.onstop = () => {
          const chunks = audioChunksRef.current;
          const recordedBlob =
            chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || mimeType }) : null;
          cleanupMediaStream();
          if (!submittedOnEndRef.current) {
            submittedOnEndRef.current = true;
            void processRecordedAudio(recordedBlob);
          }
        };
        mediaRecorderRef.current = recorder;
        usingMediaRecorderRef.current = true;
        recorder.start();
        setIsListening(true);
      } catch {
        cleanupMediaStream();
        if (!Ctor) {
          setMicError("error");
          setIsListening(false);
          return;
        }
      }
    }

    // 2. Run Browser SpeechRecognition in parallel for live interim preview & offline fallback
    if (Ctor) {
      try {
        const recognition = new Ctor();
        recognition.lang = LOCALES[language];
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          let combined = "";
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript;
          }
          const trimmed = combined.trim();
          transcriptRef.current = trimmed;
          setTranscript(trimmed);

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }

          // Wait 1s more after the user finishes speaking before automatically finishing
          if (trimmed.length >= 2) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              const rec = mediaRecorderRef.current;
              if (rec && rec.state === "recording") {
                setIsListening(false);
                try {
                  rec.stop();
                } catch {
                  // ignore
                }
                return;
              }

              if (!usingMediaRecorderRef.current) {
                setIsListening(false);
                const captured = transcriptRef.current.trim();
                if (!submittedOnEndRef.current && captured.length >= 2) {
                  submittedOnEndRef.current = true;
                  void runVoiceInstruction(captured, "browser-web-speech-fallback");
                }
              }
            }, 1000);
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
          if (!usingMediaRecorderRef.current) {
            if (event.error !== "no-speech" && event.error !== "aborted") {
              setMicError("error");
            }
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
            setIsListening(false);
          }
        };

        recognition.onend = () => {
          // If the silence timer is actively waiting for the 1s delay to elapse, let it finish
          if (silenceTimerRef.current) {
            return;
          }

          // If MediaRecorder is active and user stops talking naturally, finalize the recording
          const rec = mediaRecorderRef.current;
          if (rec && rec.state === "recording") {
            setIsListening(false);
            try {
              rec.stop();
            } catch {
              // ignore
            }
            return;
          }

          if (!usingMediaRecorderRef.current) {
            setIsListening(false);
            const captured = transcriptRef.current.trim();
            if (!submittedOnEndRef.current && captured.length >= 2) {
              submittedOnEndRef.current = true;
              void runVoiceInstruction(captured, "browser-web-speech-fallback");
            }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
      } catch {
        if (!usingMediaRecorderRef.current) {
          setMicError("error");
          setIsListening(false);
        }
      }
    }
  };

  const stopListening = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }

    const mediaRec = mediaRecorderRef.current;
    if (mediaRec && mediaRec.state === "recording") {
      setIsListening(false);
      try {
        mediaRec.stop();
        return;
      } catch {
        cleanupMediaStream();
      }
    }

    setIsListening(false);
    const captured = transcriptRef.current.trim();
    if (!submittedOnEndRef.current && captured.length >= 2) {
      submittedOnEndRef.current = true;
      void runVoiceInstruction(captured, "browser-web-speech-fallback");
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isListening) {
      stopListening();
      return;
    }
    if (transcript.trim().length >= 2 && !isProcessing) {
      void runVoiceInstruction(transcript.trim());
    }
  };

  const providerBadgeLabel =
    sttProvider === "azure-ai-speech"
      ? t("voice.provider.speech")
      : sttProvider === "azure-openai-whisper"
        ? t("voice.provider.whisper")
        : sttProvider === "browser-web-speech-fallback"
          ? t("voice.provider.browser")
          : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5 text-signal-gain" aria-hidden />
          <Kicker className="text-signal-gain">{t("voice.kicker")}</Kicker>
        </div>
        <div className="flex items-center gap-1.5">
          {providerBadgeLabel && (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                sttProvider === "browser-web-speech-fallback"
                  ? "bg-white/[0.06] text-fg-muted"
                  : "border border-sky-400/30 bg-sky-400/10 text-sky-300"
              }`}
            >
              <Cloud className="h-2.5 w-2.5" aria-hidden />
              {providerBadgeLabel}
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              movedCount >= MAX_VOICE_MOVES
                ? "bg-amber-400/15 text-amber-300"
                : "bg-white/[0.06] text-fg-muted"
            }`}
          >
            {t("voice.movesCount", { used: Math.min(movedCount, MAX_VOICE_MOVES), max: MAX_VOICE_MOVES })}
          </span>
        </div>
      </div>

      <p className="text-[12px] leading-snug text-fg-muted">{t("voice.desc")}</p>

      {/* Primary Microphone Action Button */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant={isListening ? "primary" : "secondary"}
          size="sm"
          disabled={isProcessing}
          onClick={isListening ? stopListening : () => void startListening()}
          className={`flex-1 ${
            isListening
              ? "border-signal-loss bg-signal-loss text-white hover:bg-signal-loss/90"
              : "border-signal-gain/40 hover:border-signal-gain"
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span>{t("voice.processing")}</span>
            </>
          ) : isListening ? (
            <>
              <span className="h-2 w-2 animate-ping rounded-full bg-white" aria-hidden />
              <Square className="h-3 w-3 fill-current" aria-hidden />
              <span>{t("voice.stop")}</span>
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5 text-signal-gain" aria-hidden />
              <span>{t("voice.start")}</span>
            </>
          )}
        </Button>

        {movedCount > 0 && (
          <IconButton
            size="sm"
            onClick={() => {
              setLastMoves([]);
              setLastQuery(null);
              setLimitReached(false);
              onResetMoves();
            }}
            title={t("voice.reset")}
            aria-label={t("voice.reset")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {/* Live listening indicator + interim transcript */}
      {isListening && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-1 rounded-md border border-signal-loss/50 bg-signal-loss/10 px-2.5 py-2 text-[12px]"
        >
          <div className="flex items-center gap-2 font-medium text-fg">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-signal-loss" aria-hidden />
            <span>{t("voice.listening")}</span>
          </div>
          {transcript && (
            <p className="italic text-fg-muted">“{transcript}”</p>
          )}
        </div>
      )}

      {/* Quick voice/text input box so users can also edit or type an instruction */}
      <form onSubmit={handleFormSubmit} className="flex items-center gap-1.5">
        <input
          type="text"
          value={transcript}
          onChange={(e) => {
            transcriptRef.current = e.target.value;
            setTranscript(e.target.value);
          }}
          placeholder={t("voice.placeholder")}
          disabled={isProcessing}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-ink-800 px-2.5 text-[12px] text-fg placeholder:text-fg-subtle focus:border-signal-gain focus:outline-none"
        />
        <IconButton
          type="submit"
          size="sm"
          disabled={isProcessing || transcript.trim().length < 2}
          title={t("voice.send")}
          aria-label={t("voice.send")}
        >
          <Send className="h-3.5 w-3.5" />
        </IconButton>
      </form>

      {/* 2-move limit warning */}
      {limitReached && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[11px] text-amber-200"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
          <span>{t("voice.limitReached")}</span>
        </div>
      )}

      {/* Microphone error / unsupported browser fallback notice */}
      {micError && (
        <p className="text-[11px] text-amber-300">
          {micError === "unsupported" ? t("voice.unsupported") : t("voice.micError")}
        </p>
      )}

      {/* Last applied voice move summary */}
      {lastMoves.length > 0 && lastQuery && (
        <div className="flex flex-col rounded-md border border-line bg-ink-800/50">
          <div className="border-b border-line px-2.5 py-1 text-[11px] italic text-fg-muted truncate">
            {t("voice.lastHeard", { query: lastQuery })}
          </div>
          {lastMoves.map((mv) => (
            <div
              key={mv.player_id}
              className="flex flex-col gap-0.5 border-b border-line px-2.5 py-1.5 text-[12px] last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-fg">
                  #{mv.jersey_number} {mv.player_name}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-signal-gain">
                  +{mv.displacement_m} m
                </span>
              </div>
              {mv.interpretation && (
                <p className="text-[11px] leading-snug text-fg-muted">
                  {mv.interpretation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VoiceWhatIfPanel;
