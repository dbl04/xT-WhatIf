import { AgentMessage, MatchFramePayload } from "@/types/match";
import { Audience, Language } from "@/lib/i18n";
import narrationTable from "@/mocks/match_900001_narration.json";

/**
 * Offline (no backend) narration. The pre-move reading of each key moment comes from the
 * file the backend generator writes for every language and audience
 * (frontend/src/mocks/match_900001_narration.json); the post-move debate is a short
 * heuristic in the chosen language and audience profile.
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
  opts: {
    modifiedNames: string;
    modifiedIds: number[];
    actorId: number;
    delta: number;
    simXt: number;
    passProb: number;
    audience?: Audience;
  }
): AgentMessage[] {
  const { modifiedNames, modifiedIds, actorId, delta, simXt, passProb, audience = "analyst" } = opts;
  const isUp = delta >= 0;
  const clock = `${frame.minute}:${String(frame.second).padStart(2, "0")} [${lang === "es" ? "SIMULACIÓN" : "SIMULATION"}]`;
  const signedDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
  const original = frame.metrics.original_xt.toFixed(2);
  const names = modifiedNames || (lang === "es" ? "el jugador" : "the player");
  const origPct = Math.round(frame.metrics.original_xt * 100);
  const simPct = Math.round(simXt * 100);

  const text =
    lang === "es"
      ? audience === "casual"
        ? {
            dsHeadline: isUp
              ? `Más peligro de gol (${origPct}% → ${simPct}%)`
              : `Menos peligro para la portería (${origPct}% → ${simPct}%)`,
            dsBody: isUp
              ? `Al mover a ${names}, tu equipo tiene mucho más sitio para recibir sin marca. El pase tiene un ${passProb}% de salir bien.`
              : `Al mover a ${names}, la defensa tapa el pase fácil y el peligro baja del ${origPct}% al ${simPct}%.`,
            dsMetric: `Peligro: ${origPct}% → ${simPct}% · Pase: ${passProb}%`,
            coachHeadline: isUp
              ? "Se abre un hueco claro hacia la portería"
              : "Bien tapado el pase principal",
            coachBody: isUp
              ? `Buen movimiento de ${names}: deja atrás a su marca y da una opción limpia para terminar la jugada.`
              : `Con ese paso de ${names} se cierra el camino directo y obligas al rival a buscar un pase mucho más difícil.`,
            coachMetric: isUp ? "Hueco libre en ataque" : "Pase directo cerrado",
          }
        : audience === "coach"
        ? {
            dsHeadline: isUp
              ? `Ventaja posicional generada (${signedDelta} xT)`
              : `Reducción del peligro rival (${signedDelta} xT)`,
            dsBody: isUp
              ? `Consigna: el desmarque de ${names} amplía la línea de recepción y eleva la fiabilidad del envío al ${passProb}%.`
              : `Consigna: el ajuste de ${names} cierra el carril interior y rebaja la amenaza de ${original} a ${simXt.toFixed(2)} xT.`,
            dsMetric: `ΔxT: ${signedDelta} | Fiabilidad: ${passProb}%`,
            coachHeadline: isUp
              ? "Atacar el intervalo antes de que bascule el pivote"
              : "Bloquear carril interior y orientar hacia banda",
            coachBody: isUp
              ? `Bien ajustado ${names}. Toca filtrar el pase firme al pie o al espacio antes de que salte la ayuda del central.`
              : `Buena corrección con ${names}. Cerrado el pase por dentro, obligamos al poseedor a jugar atrás o hacia fuera.`,
            coachMetric: isUp ? "Consigna: filtrar a intervalo" : "Consigna: cerrar carril interior",
          }
        : audience === "audio_description"
        ? {
            dsHeadline: isUp
              ? `Narración espacial: sube el peligro de ${origPct}% a ${simPct}%`
              : `Narración espacial: baja el peligro de ${origPct}% a ${simPct}%`,
            dsBody: isUp
              ? `En la pizarra, ${names} se desplaza hacia una zona abierta atacando de izquierda a derecha. El peligro sube del ${origPct}% al ${simPct}% con un ${passProb}% de acierto en el pase.`
              : `En la pizarra, ${names} da un paso al frente para cortar la línea de pase hacia la derecha. El peligro baja del ${origPct}% al ${simPct}%.`,
            dsMetric: `Audio: ${origPct}% a ${simPct}% (${signedDelta} xT)`,
            coachHeadline: isUp
              ? "Camino despejado hacia el área derecha"
              : "Pasillo central bloqueado por la defensa",
            coachBody: isUp
              ? `${names} gana unos metros de ventaja sobre su par y ofrece una línea de pase limpia hacia la portería derecha.`
              : `${names} ocupa el carril central frente al balón y tapa el envío directo al área.`,
            coachMetric: isUp ? "Línea de pase abierta" : "Carril central tapado",
          }
        : {
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
      : audience === "casual"
      ? {
          dsHeadline: isUp
            ? `Higher chance of scoring (${origPct}% → ${simPct}%)`
            : `Less danger near goal (${origPct}% → ${simPct}%)`,
          dsBody: isUp
            ? `Moving ${names} opens up space away from defenders. The pass now has a ${passProb}% chance of coming off.`
            : `Moving ${names} blocks the easy pass and drops the goal danger from ${origPct}% to ${simPct}%.`,
          dsMetric: `Danger: ${origPct}% → ${simPct}% · Pass: ${passProb}%`,
          coachHeadline: isUp
            ? "A clear gap opens towards goal"
            : "The main pass is shut down",
          coachBody: isUp
            ? `Smart move with ${names}: it loses the marker and gives the player on the ball a clean option.`
            : `That step from ${names} closes the direct route and forces a much tougher pass.`,
          coachMetric: isUp ? "Open space in attack" : "Direct pass blocked",
        }
      : audience === "coach"
      ? {
          dsHeadline: isUp
            ? `Positional edge created (${signedDelta} xT)`
            : `Opponent threat reduced (${signedDelta} xT)`,
          dsBody: isUp
            ? `Coaching point: ${names}'s movement widens the receiving pocket and lifts pass completion to ${passProb}%.`
            : `Coaching point: ${names}'s adjustment shuts the inside lane and drops threat from ${original} to ${simXt.toFixed(2)} xT.`,
          dsMetric: `ΔxT: ${signedDelta} | Completion: ${passProb}%`,
          coachHeadline: isUp
            ? "Hit the pocket before the pivot slides across"
            : "Lock the inside lane and force play wide",
          coachBody: isUp
            ? `Good adjustment with ${names}. Fizz the pass into feet or space before the centre-back steps out to cover.`
            : `Strong correction from ${names}. With the inside pass shut, the ball carrier has to recycle or go wide.`,
          coachMetric: isUp ? "Cue: punch pass into pocket" : "Cue: lock inside lane",
        }
      : audience === "audio_description"
      ? {
          dsHeadline: isUp
            ? `Spatial narration: danger rises from ${origPct}% to ${simPct}%`
            : `Spatial narration: danger drops from ${origPct}% to ${simPct}%`,
          dsBody: isUp
            ? `On the board, ${names} moves into open grass attacking from left to right. Goal danger rises from ${origPct}% to ${simPct}% with a ${passProb}% pass completion chance.`
            : `On the board, ${names} steps across to cut the passing lane towards the right goal. Danger drops from ${origPct}% to ${simPct}%.`,
          dsMetric: `Audio: ${origPct}% to ${simPct}% (${signedDelta} xT)`,
          coachHeadline: isUp
            ? "Clear lane towards the right-hand penalty box"
            : "Central corridor blocked by the defence",
          coachBody: isUp
            ? `${names} gains a few metres on the nearest defender and offers a clean passing line towards the right-hand goal.`
            : `${names} holds the central lane in front of the ball carrier and blocks the direct pass into the box.`,
          coachMetric: isUp ? "Passing line open" : "Central lane blocked",
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
