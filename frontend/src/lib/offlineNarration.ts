import { AgentMessage, MatchFramePayload } from "@/types/match";
import { Audience, Language } from "@/lib/i18n";
import narrationTable from "@/mocks/match_900001_narration.json";

/**
 * Offline (no backend) narration. The pre-move reading of each key moment comes from the
 * file the backend generator writes for every language and audience
 * (frontend/src/mocks/match_900001_narration.json); the post-move debate is a short
 * heuristic in the chosen language, since the full per-audience wording lives in the backend.
 */
type NarrationEntry = { moment_label: string; agent_debate: AgentMessage[] };
type NarrationTable = Record<string, Record<Language, Record<Audience, NarrationEntry>>>;

const TABLE = narrationTable as unknown as NarrationTable;

/** Key moment with its label and pre-move debate for the chosen profile (unchanged if unknown). */
export function localizeOfflineFrame(frame: MatchFramePayload, lang: Language, audience: Audience): MatchFramePayload {
  const entry = TABLE[frame.event_uuid]?.[lang]?.[audience];
  if (!entry) return frame;
  return { ...frame, moment_label: entry.moment_label, agent_debate: entry.agent_debate };
}

const AGENT_NAMES: Record<Language, { ds: string; coach: string }> = {
  en: { ds: "Dr. Voronoi (Data Scientist)", coach: "Coach Bianchi (Classic Coach)" },
  es: { ds: "Dr. Voronoi (Científico de datos)", coach: "Míster Bianchi (Entrenador clásico)" },
};

export function offlineCounterfactualDebate(
  frame: MatchFramePayload,
  lang: Language,
  opts: { modifiedNames: string; modifiedIds: number[]; actorId: number; delta: number; simXt: number; passProb: number }
): AgentMessage[] {
  const { modifiedNames, modifiedIds, actorId, delta, simXt, passProb } = opts;
  const isUp = delta >= 0;
  const clock = `${frame.minute}:${String(frame.second).padStart(2, "0")} [${lang === "es" ? "SIMULACIÓN" : "SIMULATION"}]`;
  const signedDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
  const original = frame.metrics.original_xt.toFixed(2);
  const names = modifiedNames || (lang === "es" ? "el jugador" : "the player");

  const text =
    lang === "es"
      ? {
          dsHeadline: isUp
            ? `Ganancia neta de peligro espacial (${signedDelta} xT)`
            : `Colapso del peligro esperado (${signedDelta} en xT)`,
          dsBody: isUp
            ? `Al reposicionar a ${names}, el receptor gana separación en su polígono de control. La probabilidad de completar el pase sube al ${passProb}%.`
            : `El ajuste defensivo de ${names} intercepta el cono de pase natural. El peligro cae de ${original} a ${simXt.toFixed(2)}.`,
          dsMetric: `ΔxT: ${signedDelta} | Prob: ${passProb}%`,
          coachHeadline: isUp
            ? "Espacio generado a la espalda; hay que atacar el hueco"
            : "Se cierra la ventana directa; activar la opción B",
          coachBody: isUp
            ? `Bien visto el movimiento de ${names}. Si el mediocentro no hace la cobertura de inmediato, tenemos ventaja para definir al segundo palo.`
            : "Con esa basculación nos taparon el pase cantado. Ojo a la descarga por dentro: el pase a la espalda del pivote queda libre.",
          coachMetric: isUp ? "Apertura de intervalo defensivo" : "Cobertura interior forzada",
        }
      : {
          dsHeadline: isUp
            ? `Net gain in spatial danger (${signedDelta} xT)`
            : `Expected threat collapses (${signedDelta} xT)`,
          dsBody: isUp
            ? `Repositioning ${names} gives the receiver more separation inside the control polygon. Pass completion rises to ${passProb}%.`
            : `${names}'s defensive adjustment cuts the natural passing cone. Danger falls from ${original} to ${simXt.toFixed(2)}.`,
          dsMetric: `ΔxT: ${signedDelta} | Prob: ${passProb}%`,
          coachHeadline: isUp
            ? "Space opens in behind; attack the gap"
            : "The direct window closes; switch to option B",
          coachBody: isUp
            ? `Good spot on ${names}'s movement. If the holding midfielder doesn't cover at once, we have the edge to finish at the far post.`
            : "That shift covers the obvious pass. Watch the lay-off inside: the ball behind the holding midfielder is still on.",
          coachMetric: isUp ? "Defensive gap opened" : "Inside cover forced",
        };

  const now = Date.now();
  return [
    {
      message_id: `msg-sim-${now}-voronoi`,
      agent_role: "data_scientist",
      agent_name: AGENT_NAMES[lang].ds,
      avatar_badge: "AI-QUANT",
      timestamp_label: clock,
      headline: text.dsHeadline,
      analysis_body: text.dsBody,
      referenced_metric: text.dsMetric,
      highlighted_player_ids: modifiedIds,
    },
    {
      message_id: `msg-sim-${now}-bianchi`,
      agent_role: "classic_coach",
      agent_name: AGENT_NAMES[lang].coach,
      avatar_badge: "PRO-COACH",
      timestamp_label: clock,
      headline: text.coachHeadline,
      analysis_body: text.coachBody,
      referenced_metric: text.coachMetric,
      highlighted_player_ids: [actorId, ...modifiedIds],
    },
  ];
}
