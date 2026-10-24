"use client";

import React from "react";
import { ChevronDown, Users, Volume2, VolumeX } from "lucide-react";
import { AUDIENCES, LANGUAGES, useI18n } from "@/lib/i18n";
import { useSfxMuted } from "@/lib/sfx";

/** Personalisation controls: interface/commentary language, the pundits' audience and sound effects. */
export const ProfileSwitcher: React.FC = () => {
  const { language, setLanguage, audience, setAudience, t } = useI18n();
  const [muted, setMuted] = useSfxMuted();

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex h-8 items-center rounded-md border border-line bg-ink-800 p-0.5"
        role="group"
        aria-label={t("profile.language")}
      >
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => setLanguage(lang)}
            aria-pressed={language === lang}
            lang={lang}
            title={lang === "en" ? "English" : "Español"}
            className={`h-full rounded-[4px] px-2 font-mono text-[11px] font-medium uppercase transition-colors ${
              language === lang ? "bg-white/[0.1] text-fg" : "text-fg-subtle hover:text-fg"
            }`}
          >
            {lang}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMuted(!muted)}
        aria-pressed={muted}
        title={muted ? t("sound.unmute") : t("sound.mute")}
        aria-label={muted ? t("sound.unmute") : t("sound.mute")}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-ink-800 text-fg-subtle transition-colors hover:border-line-strong hover:text-fg"
      >
        {muted ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
      </button>

      {/* Hidden on phones to keep the header within 375 px; the audience stays editable from
          the fan badge → Edit profile screen. */}
      <label
        className="relative hidden h-8 items-center sm:flex gap-1.5 rounded-md border border-line bg-ink-800 pl-2 pr-7 transition-colors hover:border-line-strong"
        title={`${t("profile.audienceTitle")}: ${t(`audience.${audience}.desc`)}`}
      >
        <Users className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="sr-only">{t("profile.audience")}</span>
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value as (typeof AUDIENCES)[number])}
          className="max-w-[9.5rem] cursor-pointer appearance-none truncate bg-transparent text-[12px] text-fg outline-none"
        >
          {AUDIENCES.map((a) => (
            <option key={a} value={a} className="bg-ink-900 text-fg">
              {t(`audience.${a}`)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-fg-subtle" />
      </label>
    </div>
  );
};

export default ProfileSwitcher;
