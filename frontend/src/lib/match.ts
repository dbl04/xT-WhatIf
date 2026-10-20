import { MatchFramePayload, MatchInfo } from "@/types/match";

/** Synthetic match served by default (backend/app/services/synthetic_generator.py). */
export const DEFAULT_MATCH_ID = 900001;

const FALLBACK_INFO: MatchInfo = {
  competition: "Partido sintético",
  venue: "",
  home: { name: "Local", short_name: "LOC", primary_color: "#75aadb" },
  away: { name: "Visitante", short_name: "VIS", primary_color: "#f4f0f8" },
  data_source: "synthetic",
};

/** Fixture metadata for a frame, with neutral labels when the payload has none. */
export function getMatchInfo(frame?: MatchFramePayload | null): MatchInfo {
  return frame?.match_info ?? FALLBACK_INFO;
}

/** "23:41 · Pase atrás desde la línea de fondo" */
export function formatMomentLabel(frame: MatchFramePayload): string {
  const clock = `${String(frame.minute).padStart(2, "0")}:${String(frame.second).padStart(2, "0")}`;
  const possession = getMatchInfo(frame)[frame.possession_team].short_name;
  return `${clock} · ${frame.moment_label ?? frame.event_type} (${possession})`;
}
