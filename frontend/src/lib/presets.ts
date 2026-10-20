"use strict";

import { MatchFramePayload, PlayerNode } from "@/types/match";

export interface TacticalPreset {
  id: string;
  label: string;
  playerId: number;
  targetX: number;
  targetY: number;
}

/**
 * Returns 3 contextual tactical simulation presets for each of the 5 Golden Highlights
 * of the 2022 World Cup Final (Argentina vs France) based on real player_id values in the frame.
 * Includes a robust smart generic fallback for any other frame.
 */
export function getPresetsForFrame(frame: MatchFramePayload): TacticalPreset[] {
  if (!frame || !frame.players || frame.players.length === 0) {
    return [];
  }

  const { minute, second, players, ball_x, ball_y, metrics } = frame;
  const isMin21 = minute === 21;
  const isMin35 = minute === 35;
  const isMin80 = minute === 80 || (minute === 79 && second === 15);
  const isMin108 = minute === 108;
  const isMin122 = minute === 122;

  // Helper to find player by preferred ID, surname match, or fallback filter
  const findP = (
    preferredId: number,
    nameSub?: string,
    fallbackFilter?: (p: PlayerNode) => boolean
  ): PlayerNode | undefined => {
    let p = players.find((x) => x.player_id === preferredId);
    if (!p && nameSub) {
      p = players.find((x) => x.name.toLowerCase().includes(nameSub.toLowerCase()));
    }
    if (!p && fallbackFilter) {
      p = players.find(fallbackFilter);
    }
    return p;
  };

  // --------------------------------------------------------------------------
  // Min 21:18 - Penalti a Di María
  // Presets:
  // 1. Dembélé Cierra Pasillo Exterior
  // 2. Koundé Ayuda Defensiva (2v1)
  // 3. Di María Recorte Interior
  // --------------------------------------------------------------------------
  if (isMin21) {
    const dembele = findP(7, "Dembélé", (p) => p.team === "away" && !p.is_keeper);
    const kounde = findP(5, "Koundé", (p) => p.team === "away" && p.player_id !== dembele?.player_id && !p.is_keeper);
    const dimaria = findP(11, "María", (p) => p.is_actor || p.team === "home");

    const presets: TacticalPreset[] = [];
    if (dembele) {
      presets.push({
        id: "p21_dembele",
        label: "Dembélé Cierra Pasillo Exterior",
        playerId: dembele.player_id,
        targetX: 98.0,
        targetY: 14.0,
      });
    }
    if (kounde) {
      presets.push({
        id: "p21_kounde",
        label: "Koundé Ayuda Defensiva (2v1)",
        playerId: kounde.player_id,
        targetX: 97.5,
        targetY: 19.5,
      });
    }
    if (dimaria) {
      presets.push({
        id: "p21_dimaria",
        label: "Di María Recorte Interior",
        playerId: dimaria.player_id,
        targetX: 94.5,
        targetY: 23.0,
      });
    }
    if (presets.length === 3) return presets;
  }

  // --------------------------------------------------------------------------
  // Min 35:42 - Gol 2-0 Di María
  // Presets:
  // 1. Koundé Retrasado (Corta Pase)
  // 2. Upamecano Bascula a Mac Allister
  // 3. Di María Diagonal al Área
  // --------------------------------------------------------------------------
  if (isMin35) {
    const kounde = findP(5, "Koundé", (p) => p.team === "away" && !p.is_keeper);
    const upamecano = findP(18, "Upamecano", (p) => p.team === "away" && p.player_id !== kounde?.player_id && !p.is_keeper);
    const dimaria = findP(11, "María", (p) => p.team === "home" && !p.is_actor);

    const presets: TacticalPreset[] = [];
    if (kounde) {
      presets.push({
        id: "p35_kounde",
        label: "Koundé Retrasado (Corta Pase)",
        playerId: kounde.player_id,
        targetX: 88.0,
        targetY: 25.0,
      });
    }
    if (upamecano) {
      presets.push({
        id: "p35_upamecano",
        label: "Upamecano Bascula a Mac Allister",
        playerId: upamecano.player_id,
        targetX: 86.0,
        targetY: 48.0,
      });
    }
    if (dimaria) {
      presets.push({
        id: "p35_dimaria",
        label: "Di María Diagonal al Área",
        playerId: dimaria.player_id,
        targetX: 101.0,
        targetY: 26.0,
      });
    }
    if (presets.length === 3) return presets;
  }

  // --------------------------------------------------------------------------
  // Min 80:25 - Gol 2-2 Mbappé
  // Presets:
  // 1. Otamendi Achica a Mbappé
  // 2. Enzo Fernández Tapa Coman
  // 3. Mbappé Desmarque Segundo Palo
  // --------------------------------------------------------------------------
  if (isMin80) {
    const otamendi = findP(19, "Otamendi", (p) => p.team === "home" && !p.is_keeper);
    const enzo =
      findP(24, "Fernández", (p) => p.team === "home" && p.player_id !== otamendi?.player_id && !p.is_keeper) ||
      findP(13, "Romero", (p) => p.team === "home" && p.player_id !== otamendi?.player_id && !p.is_keeper);
    const mbappe = findP(102, "Mbappé", (p) => p.is_actor || p.team === "away");

    const presets: TacticalPreset[] = [];
    if (otamendi) {
      presets.push({
        id: "p80_otamendi",
        label: "Otamendi Achica a Mbappé",
        playerId: otamendi.player_id,
        targetX: 34.0,
        targetY: 36.0,
      });
    }
    if (enzo) {
      presets.push({
        id: "p80_enzo",
        label: "Enzo Fernández Tapa Coman",
        playerId: enzo.player_id,
        targetX: 54.0,
        targetY: 20.0,
      });
    }
    if (mbappe) {
      presets.push({
        id: "p80_mbappe",
        label: "Mbappé Desmarque Segundo Palo",
        playerId: mbappe.player_id,
        targetX: 32.0,
        targetY: 22.0,
      });
    }
    if (presets.length === 3) return presets;
  }

  // --------------------------------------------------------------------------
  // Min 108:31 - Gol 3-2 Messi
  // Presets:
  // 1. Varane Bloquea Línea de Tiro
  // 2. Upamecano Cierra a Lautaro
  // 3. Messi Ataque al Segundo Palo
  // --------------------------------------------------------------------------
  if (isMin108) {
    const varane = findP(4, "Varane", (p) => p.team === "away" && !p.is_keeper);
    const upamecano =
      findP(18, "Upamecano", (p) => p.team === "away" && p.player_id !== varane?.player_id && !p.is_keeper) ||
      findP(5, "Koundé", (p) => p.team === "away" && p.player_id !== varane?.player_id && !p.is_keeper);
    const messi = findP(10, "Messi", (p) => p.team === "home" && !p.is_actor);

    const presets: TacticalPreset[] = [];
    if (varane) {
      presets.push({
        id: "p108_varane",
        label: "Varane Bloquea Línea de Tiro",
        playerId: varane.player_id,
        targetX: 110.0,
        targetY: 37.0,
      });
    }
    if (upamecano) {
      presets.push({
        id: "p108_upamecano",
        label: "Upamecano Cierra a Lautaro",
        playerId: upamecano.player_id,
        targetX: 108.0,
        targetY: 33.5,
      });
    }
    if (messi) {
      presets.push({
        id: "p108_messi",
        label: "Messi Ataque al Segundo Palo",
        playerId: messi.player_id,
        targetX: 116.5,
        targetY: 41.0,
      });
    }
    if (presets.length === 3) return presets;
  }

  // --------------------------------------------------------------------------
  // Min 122:43 - Atajada Legendaria Dibu Martínez vs Kolo Muani
  // Presets:
  // 1. Dibu Martínez Achique Agresivo (+3m)
  // 2. Otamendi Corte en Carrera
  // 3. Kolo Muani Pase a Mbappé Libre
  // --------------------------------------------------------------------------
  if (isMin122) {
    const dibu = findP(23, "Martínez", (p) => p.is_keeper);
    const otamendi = findP(19, "Otamendi", (p) => p.team === "home" && !p.is_keeper);
    const kolo =
      findP(112, "Muani", (p) => p.is_actor || p.team === "away") ||
      findP(102, "Mbappé", (p) => p.team === "away");

    const presets: TacticalPreset[] = [];
    if (dibu) {
      presets.push({
        id: "p122_dibu",
        label: "Dibu Martínez Achique Agresivo (+3m)",
        playerId: dibu.player_id,
        targetX: Math.max(105, dibu.x - 3.0),
        targetY: dibu.y,
      });
    }
    if (otamendi) {
      presets.push({
        id: "p122_otamendi",
        label: "Otamendi Corte en Carrera",
        playerId: otamendi.player_id,
        targetX: 102.5,
        targetY: 40.0,
      });
    }
    if (kolo) {
      presets.push({
        id: "p122_kolo",
        label: "Kolo Muani Pase a Mbappé Libre",
        playerId: kolo.player_id,
        targetX: 98.0,
        targetY: 32.0,
      });
    }
    if (presets.length === 3) return presets;
  }

  // --------------------------------------------------------------------------
  // Fallback Genérico Inteligente
  // 1. Defensor rival más cercano al balón -> Presión
  // 2. Receptor principal (optimal pass target) -> Desmarque
  // 3. Poseedor / Actor -> Amague Interior
  // --------------------------------------------------------------------------
  const actor = players.find((p) => p.is_actor) || players[0];
  const opponents = players.filter((p) => p.team !== actor.team && !p.is_keeper);
  opponents.sort(
    (a, b) =>
      Math.hypot(a.x - ball_x, a.y - ball_y) -
      Math.hypot(b.x - ball_x, b.y - ball_y)
  );
  const closestDefender = opponents[0];

  const teammates = players.filter(
    (p) => p.team === actor.team && p.player_id !== actor.player_id && !p.is_keeper
  );
  const receiver =
    teammates.find((p) => p.player_id === metrics?.optimal_pass_target_id) ||
    teammates[0];

  const presets: TacticalPreset[] = [];
  if (closestDefender) {
    const dx = ball_x - closestDefender.x;
    const dy = ball_y - closestDefender.y;
    const dist = Math.hypot(dx, dy) || 1;
    presets.push({
      id: `fallback_def_${closestDefender.player_id}`,
      label: `${closestDefender.name.split(" ").pop()} Presión Directa al Balón`,
      playerId: closestDefender.player_id,
      targetX: Number((closestDefender.x + (dx / dist) * 3.5).toFixed(1)),
      targetY: Number((closestDefender.y + (dy / dist) * 3.5).toFixed(1)),
    });
  }

  if (receiver) {
    presets.push({
      id: `fallback_rec_${receiver.player_id}`,
      label: `${receiver.name.split(" ").pop()} Desmarque en Profundidad`,
      playerId: receiver.player_id,
      targetX: Math.min(118, Number((receiver.x + 5.0).toFixed(1))),
      targetY: Number(receiver.y.toFixed(1)),
    });
  }

  if (actor) {
    presets.push({
      id: `fallback_actor_${actor.player_id}`,
      label: `${actor.name.split(" ").pop()} Amague Interior`,
      playerId: actor.player_id,
      targetX: Number((actor.x + 2.0).toFixed(1)),
      targetY: Number((actor.y < 40 ? actor.y + 6.0 : actor.y - 6.0).toFixed(1)),
    });
  }

  return presets;
}
