"use client";

import React, { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Volume2, Minus, Play, Square, ChevronUp } from "lucide-react";
import { AgentMessage, AgentRole } from "@/types/match";
import { Button, IconButton, Tag } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n";

interface BroadcastCommentatorCardProps {
  messages: AgentMessage[];
  activeSpeakingRole?: "data_scientist" | "classic_coach" | null;
  isSpeaking?: boolean;
  isSimulating?: boolean;
  highlightedPlayerIds?: number[];
  onHighlightPlayers?: (playerIds: number[]) => void;
  onPlaySingleMessage?: (msg: AgentMessage) => void;
  onPlayFullDebate?: () => void;
  onStopAudio?: () => void;
  /** Match clock shown in the strap, e.g. "35:42". */
  clockLabel?: string;
  eventType?: string;
}

/** "Dr. Voronoi (Data Scientist)" -> "Dr. Voronoi" for the name plate. */
const plateName = (agentName: string) => agentName.replace(/\s*\(.*\)\s*$/, "");

const springIn = { type: "tween", duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } as const;

export const BroadcastCommentatorCard: React.FC<BroadcastCommentatorCardProps> = ({
  messages,
  activeSpeakingRole = null,
  isSpeaking = false,
  isSimulating = false,
  onHighlightPlayers,
  onPlaySingleMessage,
  onPlayFullDebate,
  onStopAudio,
  clockLabel,
  eventType,
}) => {
  const { t, audience } = useI18n();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const onHighlightPlayersRef = useRef(onHighlightPlayers);

  useEffect(() => {
    onHighlightPlayersRef.current = onHighlightPlayers;
  }, [onHighlightPlayers]);

  // Select the pundit tab matching the chosen audience profile (Analyst/Audio -> Voronoi, Coach/Casual -> Bianchi)
  useEffect(() => {
    if (messages.length === 0) return;
    const preferredRole: AgentRole =
      audience === "coach" || audience === "casual" ? "classic_coach" : "data_scientist";
    const idx = messages.findIndex((m) => m.agent_role === preferredRole);
    if (idx !== -1) setSelectedIndex(idx);
  }, [audience, messages]);

  // When the TTS switches speaker, focus the active pundit
  useEffect(() => {
    if (activeSpeakingRole && messages.length > 0) {
      const idx = messages.findIndex((m) => m.agent_role === activeSpeakingRole);
      if (idx !== -1) {
        setSelectedIndex(idx);
        setIsMinimized(false);
      }
    }
  }, [activeSpeakingRole, messages]);

  const currentMessage = messages[selectedIndex] || messages[0];

  // Highlight on the pitch the players cited by the visible card, without render loops
  const currentMsgId = currentMessage?.message_id;
  useEffect(() => {
    if (!isMinimized && currentMessage?.highlighted_player_ids?.length) {
      onHighlightPlayersRef.current?.(currentMessage.highlighted_player_ids);
    }
  }, [selectedIndex, isMinimized, currentMsgId]);

  if (!currentMessage && !isSimulating) return null;

  const currentlyTalkingThisCard =
    isSpeaking &&
    (!activeSpeakingRole || activeSpeakingRole === currentMessage?.agent_role);

  // Editorial credentials for each pundit (the name comes from the backend message).
  const roleTitle = currentMessage ? t(`role.${currentMessage.agent_role as AgentRole}`) : null;
  const strapContext = [clockLabel, eventType].filter(Boolean).join(" · ");

  return (
    <div className="pointer-events-none relative z-40 flex w-full flex-col items-center">
      <AnimatePresence mode="wait">
        {isSimulating ? (
          /* RECALCULATING STRAP */
          <motion.div
            key="simulating-lower-third"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={springIn}
            className="pointer-events-auto w-full max-w-5xl overflow-hidden rounded-[3px] border border-line-strong bg-ink-900/95 backdrop-blur-sm"
          >
            <div className="flex items-center gap-4 px-4 py-3">
              <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-signal-gain">
                {t("card.programme")}
              </span>
              <span className="h-4 w-px bg-line-strong" />
              <span className="text-[13px] text-fg-muted">{t("card.recalculating")}</span>
            </div>
            <div className="relative h-px w-full overflow-hidden bg-line">
              <div className="absolute inset-y-0 left-0 w-1/3 animate-progress-indeterminate bg-signal-gain" />
            </div>
          </motion.div>
        ) : isMinimized ? (
          /* COLLAPSED STRAP */
          <motion.div
            key="minimized-pill"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={springIn}
            className="pointer-events-auto flex items-center gap-3 rounded-[3px] border border-line-strong bg-ink-900/95 py-1 pl-3 pr-1 backdrop-blur-sm"
          >
            <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-fg">
              {t("card.programme")}
            </span>
            <span className="font-mono text-[10px] text-fg-subtle">
              {t(messages.length === 1 ? "card.comment.one" : "card.comment.other", { n: messages.length })}
            </span>
            {(onPlaySingleMessage || onPlayFullDebate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onPlaySingleMessage && currentMessage
                    ? onPlaySingleMessage(currentMessage)
                    : onPlayFullDebate?.()
                }
              >
                <Volume2 className="h-3.5 w-3.5" />
                {t("card.listen")}
              </Button>
            )}
            <IconButton
              size="sm"
              onClick={() => setIsMinimized(false)}
              title={t("card.show")}
              aria-label={t("card.show")}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
          </motion.div>
        ) : (
          /* FULL LOWER-THIRD */
          <motion.div
            key={`card-${currentMessage.message_id || selectedIndex}`}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={springIn}
            className="pointer-events-auto w-full max-w-5xl"
          >
            {/* Top strap: programme ident + pundit switcher + controls */}
            <div className="flex items-stretch">
              <div className="flex items-center gap-2 bg-signal-gain px-3 py-1">
                <span className="font-display text-[13px] font-extrabold uppercase leading-none tracking-[0.14em] text-ink">
                  {t("card.programme")}
                </span>
              </div>
              {strapContext && (
                <div className="hidden items-center bg-ink px-3 font-display text-[13px] sm:flex font-semibold uppercase leading-none tracking-[0.08em] text-fg-muted">
                  {strapContext}
                </div>
              )}

              <div className="ml-auto flex items-center gap-1 rounded-t-[3px] border border-b-0 border-line-strong bg-ink-900/95 px-1 backdrop-blur-sm">
                {messages.length > 1 && (
                  <div className="flex items-center" role="tablist" aria-label={t("card.pundits")}>
                    {messages.map((msg, idx) => {
                      const active = idx === selectedIndex;
                      return (
                        <button
                          key={msg.message_id || idx}
                          role="tab"
                          aria-selected={active}
                          onClick={() => {
                            setSelectedIndex(idx);
                            onHighlightPlayersRef.current?.(msg.highlighted_player_ids || []);
                          }}
                          className={`relative h-7 px-2.5 font-display text-[13px] font-semibold uppercase tracking-wide transition-colors ${
                            active ? "text-fg" : "text-fg-subtle hover:text-fg-muted"
                          }`}
                        >
                          <span className="mr-1.5 font-mono text-[10px] text-fg-subtle">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          {plateName(msg.agent_name).split(" ").pop()}
                          {active && <span className="absolute inset-x-2.5 -bottom-px h-px bg-fg" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                <span className="mx-1 h-4 w-px bg-line-strong" />

                {onPlaySingleMessage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      currentlyTalkingThisCard && onStopAudio
                        ? onStopAudio()
                        : onPlaySingleMessage(currentMessage)
                    }
                    className={currentlyTalkingThisCard ? "text-fg" : undefined}
                  >
                    {currentlyTalkingThisCard ? (
                      <>
                        <Square className="h-3 w-3 fill-current" /> {t("card.stop")}
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current" /> {t("card.listen")}
                      </>
                    )}
                  </Button>
                )}

                <IconButton
                  size="sm"
                  onClick={() => {
                    setIsMinimized(true);
                    onHighlightPlayersRef.current?.([]);
                  }}
                  title={t("card.hide")}
                  aria-label={t("card.hide")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>

            {/* Main plate */}
            <div className="flex flex-col items-stretch overflow-hidden rounded-b-[3px] rounded-tr-[3px] border sm:flex-row border-line-strong bg-ink-900/95 backdrop-blur-sm">
              {/* Name plate */}
              <div className="flex w-full shrink-0 items-end justify-between gap-3 bg-fg px-4 py-3 text-ink sm:w-[220px] sm:flex-col sm:items-stretch">
                <div>
                  <div className="font-display text-[26px] font-extrabold uppercase leading-[0.95] tracking-tight">
                    {plateName(currentMessage.agent_name)}
                  </div>
                  <div className="mt-1 text-[11px] font-medium leading-tight text-ink/70">
                    {roleTitle}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:mt-3">
                  <span className="inline-flex h-5 items-center rounded-[2px] bg-ink px-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-fg">
                    {currentMessage.avatar_badge}
                  </span>
                  {currentlyTalkingThisCard && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-[2px] border border-ink/30 px-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                      {t("card.onAir")}
                    </span>
                  )}
                </div>
              </div>

              {/* Analysis */}
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-3 sm:px-5">
                <h4 className="font-display text-lg sm:truncate sm:text-[22px] font-bold leading-tight text-fg">
                  {currentMessage.headline}
                </h4>
                <p className="line-clamp-3 text-[13px] leading-relaxed text-fg-muted">
                  {currentMessage.analysis_body}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Tag tone="green">{currentMessage.referenced_metric}</Tag>
                  {currentMessage.highlighted_player_ids?.length > 0 && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
                      {t("card.inFocus")} ·{" "}
                      <span className="text-fg-muted">
                        #{currentMessage.highlighted_player_ids.join("  #")}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
