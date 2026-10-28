import { API_BASE_URL } from "@/lib/api";
import { Audience, Language } from "@/lib/i18n";
import { MatchFramePayload, PlayerNode, TeamSide } from "@/types/match";

export const MAX_VOICE_MOVES = 2;

export interface InterpretedVoiceMove {
  player_id: number;
  player_name: string;
  jersey_number: number;
  team: TeamSide;
  tactical_role: string;
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
  displacement_m: number;
  interpretation: string;
}

export interface VoiceWhatIfResult {
  limitReached: boolean;
  moves: InterpretedVoiceMove[];
  /** Present when the backend `/api/v1/agents/what-if` computed the full frame + debate. */
  simulatedFrame: MatchFramePayload | null;
}

export type STTProvider =
  | "azure-ai-speech"
  | "azure-openai-whisper"
  | "browser-web-speech-fallback";

export interface AzureSTTTranscriptionResult {
  text: string;
  provider: STTProvider;
  isFallback: boolean;
  deployment?: string | null;
  warning?: string | null;
}

const SPOKEN_NUMBERS: Record<string, string> = {
  uno: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
  once: "11",
  doce: "12",
  trece: "13",
  catorce: "14",
  quince: "15",
  dieciseis: "16",
  diecisiete: "17",
  dieciocho: "18",
  diecinueve: "19",
  veinte: "20",
  veintiuno: "21",
  veintidos: "22",
  veintitres: "23",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeSpokenNumbers(query: string): string {
  let out = foldText(query);
  for (const [word, digit] of Object.entries(SPOKEN_NUMBERS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  return out;
}

function clamp(val: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, val));
}

function parseSingleClauseOffline(
  clause: string,
  frame: MatchFramePayload,
  language: Language,
  excludedIds: Set<number>,
  allowedIds?: Set<number>
): InterpretedVoiceMove {
  const q = normalizeSpokenNumbers(clause.trim());
  const defendingTeam: TeamSide = frame.possession_team === "home" ? "away" : "home";
  const attackingTeam: TeamSide = frame.possession_team;

  const isAttackQuery = [
    "extremo",
    "delantero",
    "atacante",
    "punta",
    "desmarque",
    "espalda",
    "winger",
    "striker",
    "forward",
    "attacker",
  ].some((kw) => q.includes(kw));

  const targetTeam = isAttackQuery ? attackingTeam : defendingTeam;
  let outfield = frame.players.filter(
    (p) =>
      (!allowedIds || allowedIds.has(p.player_id)) &&
      (allowedIds ? true : p.team === targetTeam) &&
      !p.is_keeper &&
      !excludedIds.has(p.player_id)
  );
  if (outfield.length === 0) {
    outfield = frame.players.filter(
      (p) => (!allowedIds || allowedIds.has(p.player_id)) && !p.is_keeper && !excludedIds.has(p.player_id)
    );
  }
  if (outfield.length === 0) {
    outfield = frame.players.filter((p) => (!allowedIds || allowedIds.has(p.player_id)) && !p.is_keeper);
  }
  if (outfield.length === 0) {
    outfield = frame.players.filter((p) => !p.is_keeper);
  }

  let chosen: PlayerNode | undefined;
  let roleLabel = language === "es" ? "Defensor" : "Defender";

  // 1. Jersey number (#5, dorsal 5, numero 5, el 5, al 5, number 5)
  const jerseyMatch = q.match(
    /(?:#|dorsal\s+|number\s+|numero\s+|jugador\s+|player\s+|el\s+|al\s+|the\s+)(\d{1,2})\b(?!\s*(?:m\b|metros|metres|meters))/
  );
  if (jerseyMatch) {
    const jNum = Number(jerseyMatch[1]);
    chosen =
      frame.players.find(
        (p) => p.jersey_number === jNum && (!allowedIds || allowedIds.has(p.player_id)) && !excludedIds.has(p.player_id)
      ) ??
      frame.players.find((p) => p.jersey_number === jNum && (!allowedIds || allowedIds.has(p.player_id))) ??
      frame.players.find((p) => p.jersey_number === jNum);
    if (chosen) {
      roleLabel = `#${chosen.jersey_number}`;
    }
  }

  // 2. Player name match
  if (!chosen) {
    const namePool = outfield.length > 0 ? outfield : frame.players;
    for (const p of namePool) {
      if (excludedIds.has(p.player_id)) continue;
      const parts = p.name
        .split(/\s+/)
        .map(foldText)
        .filter((part) => part.length >= 3);
      if (parts.some((part) => q.includes(part))) {
        chosen = p;
        roleLabel = p.name;
        break;
      }
    }
  }

  // 3. Tactical role match
  if (!chosen) {
    if (
      ["lateral", "carrilero", "full-back", "fullback", "wing-back", "wingback", "right-back", "left-back"].some((k) =>
        q.includes(k)
      )
    ) {
      roleLabel = language === "es" ? "Lateral" : "Full-back";
      if (q.includes("derech") || q.includes("right")) {
        chosen = [...outfield].sort((a, b) => a.y - b.y)[0];
      } else if (q.includes("izquierd") || q.includes("left")) {
        chosen = [...outfield].sort((a, b) => b.y - a.y)[0];
      } else {
        const wideDefs = [...outfield].sort((a, b) => Math.abs(b.y - 40) - Math.abs(a.y - 40)).slice(0, 2);
        chosen = wideDefs.sort((a, b) => Math.abs(a.y - frame.ball_y) - Math.abs(b.y - frame.ball_y))[0];
      }
    } else if (["central", "zaguero", "centre-back", "center-back"].some((k) => q.includes(k))) {
      roleLabel = language === "es" ? "Central" : "Centre-back";
      const centralDefs = outfield.filter((p) => p.y >= 22 && p.y <= 58);
      const pool = centralDefs.length > 0 ? centralDefs : outfield;
      chosen = [...pool].sort(
        (a, b) => Math.hypot(a.x - frame.ball_x, a.y - frame.ball_y) - Math.hypot(b.x - frame.ball_x, b.y - frame.ball_y)
      )[0];
    } else if (["pivote", "mediocentro", "volante", "medio", "midfielder", "holding", "pivot"].some((k) => q.includes(k))) {
      roleLabel = language === "es" ? "Mediocentro" : "Holding Midfielder";
      chosen = [...outfield].sort((a, b) => (a.team === "away" ? a.x - b.x : b.x - a.x))[0];
    } else if (isAttackQuery) {
      roleLabel = language === "es" ? "Atacante" : "Attacker";
      const nonActors = outfield.filter((p) => !p.is_actor);
      const pool = nonActors.length > 0 ? nonActors : outfield;
      if (["extremo", "banda", "winger"].some((k) => q.includes(k))) {
        chosen = [...pool].sort((a, b) => Math.abs(b.y - 40) - Math.abs(a.y - 40))[0];
      } else {
        chosen = [...pool].sort((a, b) => b.x - a.x)[0];
      }
    } else {
      chosen = [...outfield].sort(
        (a, b) => Math.hypot(a.x - frame.ball_x, a.y - frame.ball_y) - Math.hypot(b.x - frame.ball_x, b.y - frame.ball_y)
      )[0];
    }
  }

  const target = chosen ?? outfield[0] ?? frame.players[0];
  const distMatch = q.match(/(\d+(?:\.\d+)?)\s*(?:m\b|metros|metres|meters)/);
  const targetDist = distMatch ? Math.min(5.8, Math.max(1.5, parseFloat(distMatch[1]))) : 4.2;

  const origX = target.original_x ?? target.x;
  const origY = target.original_y ?? target.y;

  let ux = 0;
  let uy = 0;
  let actionDesc = language === "es" ? "cierra la línea de pase" : "closes the passing lane";

  if (
    ["dentro", "interior", "centro", "medio", "intervalo", "inside", "inward", "half-space", "tuck", "middle", "center", "centre"].some(
      (k) => q.includes(k)
    )
  ) {
    const dyDir = target.y < 40 ? 1 : -1;
    const focalX = frame.ball_end_x ?? frame.ball_x;
    const dxDir = focalX > target.x ? 0.35 : -0.35;
    const norm = Math.hypot(dxDir, dyDir) || 1;
    ux = dxDir / norm;
    uy = dyDir / norm;
    actionDesc = language === "es" ? "cierra por dentro" : "tucks inside";
  } else if (["banda", "fuera", "abre", "abrir", "exterior", "wide", "outside", "touchline", "flank"].some((k) => q.includes(k))) {
    ux = 0;
    uy = target.y < 40 ? -1 : 1;
    actionDesc = language === "es" ? "bascula a la banda" : "shifts wide";
  } else if (
    ["presion", "encima", "acosa", "achica", "salga", "salir", "balon", "poseedor", "press", "step up", "steps up", "jump", "carrier"].some(
      (k) => q.includes(k)
    )
  ) {
    const dx = frame.ball_x - target.x;
    const dy = frame.ball_y - target.y;
    const norm = Math.max(0.1, Math.hypot(dx, dy));
    ux = dx / norm;
    uy = dy / norm;
    actionDesc = language === "es" ? "sale a presionar" : "steps out to press";
  } else if (
    ["adelant", "sube", "subir", "suba", "arriba", "delante", "desmarque", "espalda", "profundidad", "forward", "higher", "push up", "advance", "behind"].some(
      (k) => q.includes(k)
    )
  ) {
    ux = target.team === "away" ? -1 : 1;
    uy = 0;
    actionDesc = language === "es" ? "adelanta su posición" : "steps higher up";
  } else if (["recula", "retrocede", "hunde", "atras", "baja", "bajar", "baje", "drop", "deeper", "back", "retreat"].some((k) => q.includes(k))) {
    ux = target.team === "away" ? 1 : -1;
    uy = 0;
    actionDesc = language === "es" ? "recula hacia su área" : "drops deeper";
  } else {
    const destX = frame.ball_end_x ?? frame.ball_x;
    const destY = frame.ball_end_y ?? 40;
    const midX = 0.6 * destX + 0.4 * frame.ball_x;
    const midY = 0.6 * destY + 0.4 * frame.ball_y;
    const dx = midX - target.x;
    const dy = midY - target.y;
    const norm = Math.max(0.1, Math.hypot(dx, dy));
    ux = dx / norm;
    uy = dy / norm;
  }

  const toX = clamp(Number((origX + ux * targetDist).toFixed(1)), 1.0, 119.0);
  const toY = clamp(Number((origY + uy * targetDist).toFixed(1)), 1.0, 79.0);
  const disp = Number(Math.hypot(toX - origX, toY - origY).toFixed(1));

  return {
    player_id: target.player_id,
    player_name: target.name,
    jersey_number: target.jersey_number,
    team: target.team,
    tactical_role: roleLabel,
    from_x: Number(origX.toFixed(1)),
    from_y: Number(origY.toFixed(1)),
    to_x: toX,
    to_y: toY,
    displacement_m: disp,
    interpretation: `${roleLabel} ${target.name} (#${target.jersey_number}) ${actionDesc} (${disp} m)`,
  };
}

export function interpretVoiceMovesOffline(
  query: string,
  frame: MatchFramePayload,
  language: Language,
  maxMoves: number = MAX_VOICE_MOVES,
  allowedPlayerIds?: number[]
): InterpretedVoiceMove[] {
  const cap = Math.max(1, Math.min(MAX_VOICE_MOVES, maxMoves));
  const usedIds = new Set<number>();
  const allowedSet = allowedPlayerIds && allowedPlayerIds.length > 0 ? new Set(allowedPlayerIds) : undefined;
  const qNorm = normalizeSpokenNumbers(query);

  const clauses = query
    .split(/\s+(?:y\s+que|y\s+el|y\s+la|y\s+al|y\s+#|and\s+the|and\s+#|and\s+have|;\s*|\s+y\s+|\s+and\s+|\s+e\s+)/i)
    .map((c) => c.trim())
    .filter((c) => c.length >= 3);

  const moves: InterpretedVoiceMove[] = [];
  if (clauses.length >= 2 && cap >= 2) {
    for (const clause of clauses.slice(0, cap)) {
      const mv = parseSingleClauseOffline(clause, frame, language, usedIds, allowedSet);
      if (!usedIds.has(mv.player_id)) {
        usedIds.add(mv.player_id);
        moves.push(mv);
      }
    }
    if (moves.length > 0) return moves;
  }

  const wantsTwo =
    cap >= 2 &&
    [
      "los 2",
      "las 2",
      "ambos",
      "2 defens",
      "2 central",
      "2 jugador",
      "los central",
      "los lateral",
      "both",
      "2 defender",
      "2 player",
      "centre-backs",
      "center-backs",
      "full-backs",
    ].some((kw) => qNorm.includes(kw));

  const first = parseSingleClauseOffline(query, frame, language, usedIds, allowedSet);
  usedIds.add(first.player_id);
  moves.push(first);

  if (wantsTwo && moves.length < cap) {
    const second = parseSingleClauseOffline(query, frame, language, usedIds, allowedSet);
    if (!usedIds.has(second.player_id)) {
      usedIds.add(second.player_id);
      moves.push(second);
    }
  }

  return moves;
}

/**
 * Resolves a spoken or typed tactical instruction into 1 or 2 player moves, enforcing the
 * hard limit of 2 moved players on the current key moment.
 */
export async function executeVoiceWhatIf(
  query: string,
  frame: MatchFramePayload,
  language: Language,
  audience: Audience,
  movablePlayerIds?: number[]
): Promise<VoiceWhatIfResult> {
  const alreadyMoved = frame.players.filter((p) => p.is_modified);
  const alreadyMovedIds = new Set(alreadyMoved.map((p) => p.player_id));

  // First check offline candidate moves to verify whether the 2-move limit would be exceeded
  const candidateOfflineMoves = interpretVoiceMovesOffline(query, frame, language, MAX_VOICE_MOVES, movablePlayerIds);
  const allowedOfflineMoves = candidateOfflineMoves.filter((mv) => {
    if (alreadyMovedIds.has(mv.player_id)) return true;
    const totalIfAdded = alreadyMovedIds.size + 1;
    if (totalIfAdded <= MAX_VOICE_MOVES) {
      alreadyMovedIds.add(mv.player_id);
      return true;
    }
    return false;
  });

  if (allowedOfflineMoves.length === 0) {
    return { limitReached: true, moves: [], simulatedFrame: null };
  }

  // Try backend `/api/v1/agents/what-if`
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/agents/what-if`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        match_id: frame.match_id,
        event_uuid: frame.event_uuid,
        language,
        audience,
        existing_moves: alreadyMoved.map((p) => ({
          player_id: p.player_id,
          x: p.x,
          y: p.y,
          original_x: p.original_x ?? p.x,
          original_y: p.original_y ?? p.y,
        })),
        max_moves: MAX_VOICE_MOVES,
      }),
      signal: AbortSignal.timeout(4500),
    });

    if (res.ok) {
      const data = await res.json();
      const rawMoves: InterpretedVoiceMove[] =
        Array.isArray(data.interpreted_moves) && data.interpreted_moves.length > 0
          ? data.interpreted_moves
          : data.interpreted_move
            ? [data.interpreted_move]
            : allowedOfflineMoves;

      // Filter against the 2-move limit on the board
      const currentMovedIds = new Set(alreadyMoved.map((p) => p.player_id));
      const acceptedMoves: InterpretedVoiceMove[] = [];
      for (const mv of rawMoves) {
        if (currentMovedIds.has(mv.player_id) || currentMovedIds.size < MAX_VOICE_MOVES) {
          currentMovedIds.add(mv.player_id);
          acceptedMoves.push(mv);
        }
      }

      if (acceptedMoves.length === 0) {
        return { limitReached: true, moves: [], simulatedFrame: null };
      }

      return {
        limitReached: false,
        moves: acceptedMoves,
        simulatedFrame: data.simulated_frame ?? null,
      };
    }
  } catch {
    // Offline fallback below
  }

  return {
    limitReached: false,
    moves: allowedOfflineMoves,
    simulatedFrame: null,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = res.indexOf(",");
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Sends recorded microphone audio to `/api/v1/speech/transcribe` (Azure AI Speech Fast STT with
 * Phrase List -> Azure OpenAI Whisper `whisper-1` -> graceful Browser Web Speech fallback).
 */
export async function transcribeVoiceWithAzure(
  audioBlob: Blob,
  frame: MatchFramePayload,
  language: Language
): Promise<AzureSTTTranscriptionResult> {
  try {
    const audioBase64 = await blobToBase64(audioBlob);
    if (!audioBase64 || audioBase64.length < 16) {
      return {
        text: "",
        provider: "browser-web-speech-fallback",
        isFallback: true,
      };
    }

    const playerNames = frame.players.map((p) => p.name);
    const res = await fetch(`${API_BASE_URL}/api/v1/speech/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: audioBlob.type || "audio/webm",
        language,
        player_names: playerNames,
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        text: typeof data.text === "string" ? data.text.trim() : "",
        provider: (data.provider as STTProvider) ?? "browser-web-speech-fallback",
        isFallback: Boolean(data.is_fallback),
        deployment: data.deployment ?? null,
        warning: data.warning ?? null,
      };
    }
  } catch {
    // Graceful fallback to Browser Web Speech API or manual text
  }

  return {
    text: "",
    provider: "browser-web-speech-fallback",
    isFallback: true,
  };
}
