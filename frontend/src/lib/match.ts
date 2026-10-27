import { MatchFramePayload, MatchInfo } from "@/types/match";

/** Synthetic match served by default (backend/app/services/synthetic_generator.py). */
export const DEFAULT_MATCH_ID = 900001;

const FALLBACK_INFO: MatchInfo = {
  competition: "Synthetic match",
  venue: "",
  home: { name: "Home", short_name: "HOM", primary_color: "#75aadb" },
  away: { name: "Away", short_name: "AWY", primary_color: "#f4f0f8" },
  data_source: "synthetic",
};

export const MOMENT_LABELS: Record<string, { en: string; es: string }> = {
  wide_carry: { en: "Wide carry into the box", es: "Conducción por banda hacia el área" },
  counter_through: { en: "Counter-attack: ball into space", es: "Contraataque: pase al espacio" },
  cutback: { en: "Cut-back from the byline", es: "Pase atrás desde la línea de fondo" },
  half_space: { en: "Through ball into the half-space", es: "Pase filtrado al pasillo interior" },
  switch: { en: "Switch of play to the far side", es: "Cambio de orientación a la banda contraria" },
  edge_shot: { en: "Shot from the edge of the box", es: "Disparo desde la frontal del área" },
  one_v_one: { en: "One-on-one with the keeper", es: "Mano a mano con el portero" },
  buildup_pass: { en: "Build-up pass", es: "Pase en la salida" },
  progressive_pass: { en: "Pass forward", es: "Pase hacia delante" },
  carry: { en: "Ball carry", es: "Conducción" },
};

export const EVENT_TYPE_LABELS: Record<string, { en: string; es: string }> = {
  Pass: { en: "Pass", es: "Pase" },
  Dribble: { en: "Dribble", es: "Regate" },
  Shot: { en: "Shot", es: "Disparo" },
  Carry: { en: "Carry", es: "Conducción" },
};

const EN_TO_ES_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.values(MOMENT_LABELS).map((v) => [v.en, v.es])),
  ...Object.fromEntries(Object.values(EVENT_TYPE_LABELS).map((v) => [v.en, v.es])),
};

/** Localised label for a live or offline match event in the chosen UI language. */
export function localizeEventLabel(
  event: { moment_key?: string | null; labels?: Partial<Record<"en" | "es", string>>; event_type: string },
  language: "en" | "es"
): string {
  if (event.moment_key && MOMENT_LABELS[event.moment_key]) {
    return MOMENT_LABELS[event.moment_key][language];
  }
  const raw = event.labels?.[language] || event.labels?.en || event.event_type;
  if (language === "es" && EN_TO_ES_LABELS[raw]) {
    return EN_TO_ES_LABELS[raw];
  }
  if (EVENT_TYPE_LABELS[event.event_type]) {
    return EVENT_TYPE_LABELS[event.event_type][language];
  }
  return raw;
}

/** Fixture metadata for a frame, with neutral labels when the payload has none. */
export function getMatchInfo(frame?: MatchFramePayload | null): MatchInfo {
  return frame?.match_info ?? FALLBACK_INFO;
}

/** "86:56 · Cut-back from the byline (SMR)" */
export function formatMomentLabel(frame: MatchFramePayload, language: "en" | "es" = "en"): string {
  const clock = `${String(frame.minute).padStart(2, "0")}:${String(frame.second).padStart(2, "0")}`;
  const possession = getMatchInfo(frame)[frame.possession_team].short_name;
  const label = localizeEventLabel(
    {
      moment_key: frame.moment_key,
      labels: frame.moment_label ? { en: frame.moment_label, es: frame.moment_label } : undefined,
      event_type: frame.event_type,
    },
    language
  );
  return `${clock} · ${label} (${possession})`;
}
