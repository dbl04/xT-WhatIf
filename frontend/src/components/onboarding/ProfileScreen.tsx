"use client";

import React, { useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { AUDIENCES, Audience, LANGUAGES, Language, useI18n } from "@/lib/i18n";
import { NICKNAME_MAX, normalizeNickname, validateNickname } from "@/lib/fan";
import { cn } from "@/lib/utils";

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

/**
 * Step 1: nickname, language and audience. Language and audience go straight to the i18n
 * context (so this screen re-renders in the chosen language); cancelling an edit restores them.
 */
export const ProfileScreen: React.FC<{
  initialNickname?: string;
  /** Present when editing an existing profile. */
  onCancel?: () => void;
  onSubmit: (nickname: string) => void;
}> = ({ initialNickname = "", onCancel, onSubmit }) => {
  const { language, setLanguage, audience, setAudience, t } = useI18n();
  const [nickname, setNickname] = useState(initialNickname);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const snapshot = useRef({ language, audience });
  const ids = useId();
  const isEditing = Boolean(onCancel);

  const error = validateNickname(nickname);
  const showError = touched && error !== null;
  const errorText =
    error === "tooShort" ? t("fanProfile.nicknameTooShort") : error === "tooLong" ? t("fanProfile.nicknameTooLong") : "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(normalizeNickname(nickname));
  };

  const handleCancel = () => {
    setLanguage(snapshot.current.language);
    setAudience(snapshot.current.audience);
    onCancel?.();
  };

  return (
    <OnboardingShell
      step={1}
      totalSteps={2}
      title={isEditing ? t("fanProfile.editTitle") : t("fanProfile.title")}
      description={t("fanProfile.desc")}
    >
      <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-7">
        {/* Nickname */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-nick`} className="font-display text-sm font-bold uppercase tracking-wide text-fg">
            {t("fanProfile.nickname")}
          </label>
          <input
            ref={inputRef}
            id={`${ids}-nick`}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={NICKNAME_MAX + 10}
            autoComplete="nickname"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder={t("fanProfile.nicknamePlaceholder")}
            aria-invalid={showError}
            aria-describedby={`${ids}-nick-hint${showError ? ` ${ids}-nick-err` : ""}`}
            className={cn(
              "h-11 w-full rounded-md border bg-ink-800 px-3 text-[15px] text-fg placeholder:text-fg-subtle",
              "outline-none transition-colors focus-visible:border-signal-gain focus-visible:ring-1 focus-visible:ring-signal-gain",
              showError ? "border-signal-loss" : "border-line-strong hover:border-fg-subtle"
            )}
          />
          <p id={`${ids}-nick-hint`} className="text-[12px] text-fg-subtle">
            {t("fanProfile.nicknameHint")}
          </p>
          {showError && (
            <p id={`${ids}-nick-err`} role="alert" className="text-[12px] text-signal-loss">
              {errorText}
            </p>
          )}
        </div>

        {/* Language */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-display text-sm font-bold uppercase tracking-wide text-fg">
            {t("profile.language")}
          </legend>
          <div className="flex gap-2" role="group" aria-describedby={`${ids}-lang-hint`}>
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                lang={lang}
                aria-pressed={language === lang}
                onClick={() => setLanguage(lang)}
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-2 rounded-md border text-[14px] font-medium transition-colors sm:flex-none sm:px-5",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal-gain",
                  language === lang
                    ? "border-signal-gain bg-signal-gain/10 text-fg"
                    : "border-line-strong bg-ink-800 text-fg-muted hover:text-fg"
                )}
              >
                <span className="font-mono text-[11px] uppercase text-fg-subtle">{lang}</span>
                {LANGUAGE_NAMES[lang]}
              </button>
            ))}
          </div>
          <p id={`${ids}-lang-hint`} className="text-[12px] text-fg-subtle">
            {t("fanProfile.languageHint")}
          </p>
        </fieldset>

        {/* Audience */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-display text-sm font-bold uppercase tracking-wide text-fg">
            {t("profile.audience")}
          </legend>
          <p className="-mt-1 mb-1 text-[12px] text-fg-subtle">{t("fanProfile.audienceHint")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AUDIENCES.map((a) => (
              <label
                key={a}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                  "has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal-gain",
                  audience === a
                    ? "border-signal-gain bg-signal-gain/10"
                    : "border-line-strong bg-ink-800 hover:border-fg-subtle"
                )}
              >
                <input
                  type="radio"
                  name={`${ids}-audience`}
                  value={a}
                  checked={audience === a}
                  onChange={() => setAudience(a as Audience)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-signal-gain"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-medium text-fg">{t(`audience.${a}`)}</span>
                  <span className="text-[12px] text-fg-muted">{t(`audience.${a}.desc`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button variant="ghost" onClick={handleCancel} className="h-11 px-5 text-sm">
              {t("fanProfile.cancel")}
            </Button>
          )}
          <Button type="submit" variant="primary" className="h-11 px-6 text-sm">
            {isEditing ? t("fanProfile.save") : t("fanProfile.continue")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </OnboardingShell>
  );
};

export default ProfileScreen;
