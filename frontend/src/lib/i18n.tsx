"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Personalisation: interface language (en / es) and audience profile.
 * The audience is sent to the backend, which writes the pundits' debate for it
 * (backend/app/services/narration.py); the interface strings live here.
 */
export type Language = "en" | "es";
export type Audience = "casual" | "analyst" | "coach" | "audio_description";

export const LANGUAGES: Language[] = ["en", "es"];
export const AUDIENCES: Audience[] = ["casual", "analyst", "coach", "audio_description"];
export const DEFAULT_LANGUAGE: Language = "en";
export const DEFAULT_AUDIENCE: Audience = "analyst";

const en = {
  // Header
  "header.syntheticData": "Synthetic data",
  "header.simulated": "Simulated scenario",
  "header.original": "Original play",
  "nav.panel": "Panel",
  "nav.panelTitle": "Show / hide the tactical panel",
  "nav.compare": "Compare",
  "nav.compareTitle": "Compare two counterfactual hypotheses",
  "nav.infra": "Infrastructure",
  "nav.infraTitle": "Azure Container Apps and AKS telemetry",
  "nav.guideTitle": "Quick demo guide",
  "nav.guideAria": "Quick guide",
  "nav.export": "Export",
  "nav.exportTitle": "Export the tactical report as PNG",

  // Personalisation
  "profile.language": "Language",
  "profile.audience": "Audience",
  "profile.audienceTitle": "Who the pundits talk to",
  "audience.casual": "Casual fan",
  "audience.analyst": "Analyst",
  "audience.coach": "Coach",
  "audience.audio_description": "Audio description",
  "audience.casual.desc": "Plain words, no jargon",
  "audience.analyst.desc": "Full metrics: xT, pass probability, Voronoi",
  "audience.coach.desc": "Verdict and coaching points",
  "audience.audio_description.desc": "Spoken, spatial narration for blind and low-vision fans",

  // Tactical dock
  "dock.quickScenarios": "Quick scenarios",
  "preset.press": "{name} presses the ball carrier",
  "preset.cut": "{name} cuts the passing lane",
  "preset.run": "{name} attacks the space behind",

  // Auto-Coach
  "coach.radius": "radius ≤ 6.0 m",
  "coach.desc": "Repositions the two nearest defenders to minimise the opponent's xT.",
  "coach.optimise": "Optimise defence",
  "coach.optimising": "Optimising…",
  "coach.restore": "Restore original positions",
  "coach.badge": "{count} configurations · {ms} ms",

  // xT panel
  "xt.simulated": "Simulated",
  "xt.original": "Original",
  "xt.reset": "Reset the original play",
  "xt.export": "Export tactical report",
  "xt.originalXt": "Original xT",
  "xt.simulatedXt": "Simulated xT",
  "xt.unchanged": "No change from the original play.",
  "xt.more": "The change creates more danger.",
  "xt.less": "The change reduces the danger.",
  "xt.territory": "Territorial control",
  "xt.pass": "Pass probability",

  // Pundits lower-third
  "card.programme": "Tactical Analysis",
  "card.recalculating": "Recalculating the 16×12 xT grid and preparing the analysis…",
  "card.comment.one": "{n} comment",
  "card.comment.other": "{n} comments",
  "card.listen": "Listen",
  "card.stop": "Stop",
  "card.show": "Show analysis",
  "card.hide": "Hide analysis",
  "card.pundits": "Pundits",
  "card.onAir": "On air",
  "card.inFocus": "In focus",
  "role.data_scientist": "Data analyst",
  "role.classic_coach": "Tactical analyst",

  // Playback bar
  "playback.previous": "Previous play",
  "playback.next": "Next play",
  "playback.play": "Play",
  "playback.pause": "Pause",
  "playback.moment": "Key moment",
  "playback.timeline": "Match timeline",
  "playback.speed": "Speed",
  "playback.reset": "Reset play",
  "playback.resetTitle": "Restore the play's original positions",

  // Pitch
  "pitch.title": "Tactical board",
  "pitch.subtitle": "Synthetic data · 120 × 80 m",
  "pitch.layers": "Layers",
  "layer.voronoi": "Voronoi",
  "layer.xt": "xT grid",
  "layer.pass": "Pass lanes",
  "layer.ghost": "Displacements",
  "pitch.inertiaOver": "INERTIA > 6 M · PENALTY",
  "pitch.inertiaOk": "WITHIN RADIUS",
  "pitch.origin": "ORIGIN",
  "pitch.target": "TARGET",
  "pitch.bestOption": "BEST OPTION",
  "pitch.newPass": "NEW PASS",
  "pitch.hint": "Drag any player to simulate the scenario.",
  "pitch.bestPass": "Best pass",
  "pitch.cellXt": "xT cell",
  "pitch.zone": "Zone",
  "pitch.zoom": "Zoom",
  "pitch.full": "Full pitch",
  "pitch.viewAria": "Pitch view",
  "pitch.offside": "OFFSIDE LINE",

  // xT Live Challenge
  "challenge.kicker": "xT Live Challenge",
  "challenge.play": "Play this moment",
  "challenge.playAria": "Play this moment: {mode}. {s} seconds to move up to {n} players.",
  "challenge.possession": "In possession: {team}",
  "challenge.playMeta": "{s} s · up to {n} players · {r} m each",
  "challenge.mode.attack": "Attack",
  "challenge.mode.defend": "Defend",
  "challenge.goal.attack": "Raise the threat",
  "challenge.goal.defend": "Lower the threat",
  "challenge.task.attack": "Move teammates of the ball carrier into better spots.",
  "challenge.task.defend": "Move your defenders to shut the danger down.",
  "challenge.time": "Time",
  "challenge.timeAria": "{s} seconds left",
  "challenge.tenSeconds": "10 seconds left",
  "challenge.timeUp": "Time's up: your moves have been submitted.",
  "challenge.moves": "Moves",
  "challenge.trend": "Trend",
  "challenge.trend.better": "Better",
  "challenge.trend.worse": "Worse",
  "challenge.trend.same": "No change",
  "challenge.trendAria.better": "Trend: better for your team",
  "challenge.trendAria.worse": "Trend: worse for your team",
  "challenge.trendAria.same": "Trend: no change",
  "challenge.checking": "Checking…",
  "challenge.offline": "Offline: the trend is not available",
  "challenge.rules": "Up to {n} players · {r} m radius · {d} m apart",
  "challenge.offsideHint": "Dashed line: offside. Teammates who start onside cannot cross it.",
  "challenge.limit": "You can only move {n} players. Reset to pick others.",
  "challenge.locked": "Only the players with a green ring can move.",
  "challenge.violations": "Rule breaks",
  "challenge.illegalNote": "Fix them before you confirm.",
  "challenge.rule.too_far": "Too far",
  "challenge.rule.too_many": "Too many players",
  "challenge.rule.not_movable": "Cannot move",
  "challenge.rule.off_pitch": "Off the pitch",
  "challenge.rule.too_close": "Too close",
  "challenge.rule.offside": "Offside",
  "challenge.rule.unknown_player": "Unknown player",
  "challenge.reset": "Reset moves",
  "challenge.confirm": "Confirm",
  "challenge.leave": "Leave the challenge",
  "challenge.yourMoves": "Your moves",
  "challenge.noMoves": "No moves: you kept the original shape.",
  "challenge.revealSoon": "The result is revealed when the moment closes.",
  "challenge.back": "Back to analysis",
  "challenge.hint": "Drag a player with a green ring: up to {n}, within {r} m.",
  "challenge.delivery.sending": "Sending your moves…",
  "challenge.delivery.reconnecting": "Connection lost. Your moves will be sent as soon as it is back.",
  "challenge.delivery.received": "Moves received by the match.",
  "challenge.delivery.failed": "Your moves were not counted: {reason}",
  "challenge.delivery.reason.closed": "the moment had already closed.",
  "challenge.delivery.reason.late": "they arrived after the window closed.",
  "challenge.delivery.reason.rules": "a move broke the rules.",
  "challenge.delivery.reason.invalid": "the message could not be read.",
  "sound.mute": "Mute sound effects",
  "sound.unmute": "Turn sound effects on",
  "zone.box": "Opponent's penalty box",
  "zone.zone14": "Zone 14 (edge of the box)",
  "zone.leftHalfSpace": "Opponent's left half-space",
  "zone.rightHalfSpace": "Opponent's right half-space",
  "zone.leftFlank": "Left outside lane",
  "zone.rightFlank": "Right outside lane",
  "zone.ownHalf": "Own half",
  "zone.centralAttack": "Central attacking zone",

  // Demo guide
  "guide.kicker": "Quick guide · 60 s",
  "guide.title": "How to use xT-WhatIf",
  "guide.desc": "Recommended flow for a live demo.",
  "guide.footer": "Synthetic data · Azure",
  "guide.start": "Start",
  "guide.step1.title": "Pick a key moment",
  "guide.step1.desc":
    "Choose one of the key moments of the synthetic match (a counter-attack, a cut-back, a one-on-one…) in the selector of the bottom dock.",
  "guide.step2.title": "Play the sequence",
  "guide.step2.desc":
    "Press Play to watch the ball travel and the 1.5 to 3.5 m micro-runs: receivers attacking space and defenders shifting across.",
  "guide.step3.title": "Drag a defender",
  "guide.step3.desc":
    "Watch the 6.0 m inertia ring: go beyond it and it turns magenta and xT is penalised. Follow Δ xT and the green line to the best passing option.",
  "guide.step4.title": "Choose language and audience",
  "guide.step4.desc":
    "At the top right, switch between English and Spanish and pick who the pundits talk to: casual fans, analysts, coaches or audio description.",
  "guide.step5.title": "Listen to the analysis and export",
  "guide.step5.desc":
    "The lower-third sums up Dr. Voronoi's and Coach Bianchi's reading and highlights the players they mention. Use Export to download the PNG report.",

  // Export
  "export.kicker": "Export",
  "export.title": "Tactical report",
  "export.desc": "Board, xT metrics and the pundits' reading in a 1600 × 1200 PNG.",
  "export.ready": "Ready to share with the coaching staff.",
  "export.cancel": "Cancel",
  "export.download": "Download PNG",
  "export.downloaded": "Downloaded",
  "export.generating": "Generating report…",
  "export.alt": "Tactical report preview",
  "export.failed": "The report could not be generated.",
  "report.ident": "TACTICAL ANALYSIS",
  "report.header": "xT/WHATIF · SCOUT REPORT · {date}",
  "report.synthetic": "SYNTHETIC DATA",
  "report.simulated": "SIMULATED SCENARIO",
  "report.original": "ORIGINAL PLAY",
  "report.originalXt": "ORIGINAL xT",
  "report.simulatedXt": "SIMULATED xT",
  "report.territory": "TERRITORIAL CONTROL",
  "report.pass": "PASS PROBABILITY",
  "report.dsFallbackHeadline": "xT corridor optimisation",
  "report.dsFallbackBody": "Changing the position produces significant variations in the receiver's Expected Threat.",
  "report.coachFallbackHeadline": "Dressing-room judgement and cover shifts",
  "report.coachFallbackBody": "No centre-back drops that deep without breaking the offside trap. Tactical discipline rules.",
  "report.footer":
    "xT-WhatIf © 2026 · Counterfactual tactical intelligence · Synthetic data · Voronoi tessellation · Inertia penalty r = 6.0 m",

  // Scenario comparator
  "compare.kicker": "Comparator",
  "compare.title": "Scenario A vs B",
  "compare.desc": "Save two hypotheses and compare the reduction in danger against the physical effort.",
  "compare.verdict": "Verdict",
  "compare.pinBoth": "Pin both scenarios to compare their tactical efficiency.",
  "compare.winner": "Scenario {key} is more efficient ({ratio} ΔxT/m): it removes more danger per metre run.",
  "compare.tie": "Both scenarios have the same risk/reward profile.",
  "compare.scenario": "Scenario {key}",
  "compare.moreEfficient": "More efficient",
  "compare.threat": "Threat (xT)",
  "compare.control": "Voronoi control",
  "compare.passSuccess": "Pass success",
  "compare.totalDisplacement": "Total displacement",
  "compare.restore": "Restore on the board",
  "compare.empty": "Move players and press “Pin {key}”.",
  "compare.onBoard": "On the board: {n} players moved",
  "compare.pin": "Pin {key}",
  "compare.original": "Original",
  "compare.unchanged": "Unchanged play",
  "compare.baseThreat": "Base threat (xT)",
  "compare.displacement": "Displacement",

  // Cloud telemetry
  "cloud.kicker": "Infrastructure",
  "cloud.title": "Cloud telemetry",
  "cloud.desc": "Dual-role architecture: gateway on ACA, workers on AKS and agents on AI Foundry.",
  "cloud.refresh": "Refresh telemetry",
  "cloud.close": "Close",
  "cloud.services": "Services",
  "cloud.breakerOpen": "Circuit breaker open",
  "cloud.operational": "Operational",
  "cloud.down": "Down",
  "cloud.acaDetail": "Public gateway · WebSocket · Circuit breaker · KEDA 1–10 replicas",
  "cloud.replicas": "Replicas",
  "cloud.aksDown": "Failure injected. Traffic is served by the gateway.",
  "cloud.aksDetail": "Voronoi + xT compute · HPA 3–12 pods",
  "cloud.agents": "gpt-4o · 2 agents",
  "cloud.agentsDetail": "Debate between Dr. Voronoi (data) and Coach Bianchi (tactics)",
  "cloud.model": "Model",
  "cloud.latency": "Latency",
  "cloud.lastCalc": "Last calculation",
  "cloud.cacheNote": "In-memory LRU cache",
  "cloud.simulations": "Simulations",
  "cloud.simulationsNote": "Scenarios computed",
  "cloud.breakerNote": "Switches to local compute",
  "cloud.performance": "Performance",
  "cloud.live": "Live tests",
  "cloud.liveDesc": "Measure the geometric engine and check how the circuit breaker reacts to an injected failure.",
  "cloud.bursting": "Running 25 simulations…",
  "cloud.burst": "Run a burst of 25 simulations",
  "cloud.restoreAks": "Restore AKS",
  "cloud.killAks": "Simulate AKS outage",
  "cloud.burstDone": "Burst of {n} simulations completed",
  "cloud.burstStats": "Total {total} ms · mean {avg} ms/sim · {lookups} spatial queries",
  "cloud.chaosOn":
    "AKS failure injected → circuit breaker open on the ACA gateway → local fallback compute serving (0% packet loss)",
  "cloud.chaosOff": "Normal operation restored: AKS cluster healthy and in sync.",
  "cloud.simulatedNote": "Replica, pod and CPU figures are simulated from request load for the demo.",

  "live.kicker": "Live match",
  "live.connecting": "Connecting to the live match…",
  "live.waitingMoment": "The next challenge opens at a key moment of the match.",
  "live.ticker": "Latest",
  "live.fans": "{n} fans playing",
  "live.practice": "Practise the key moments",
  "live.backToLive": "Back to the live match",
  "live.offline": "Live match unavailable: practise the key moments.",
  "live.outcome.completed": "Done",
  "live.outcome.intercepted": "Lost",
  "live.outcome.goal": "Goal",
  "live.outcome.saved": "Saved",
  "live.outcome.missed": "Off target",
  "live.outcome.blocked": "Blocked",
  "reveal.kicker": "Result",
  "reveal.yourScore": "Your score",
  "reveal.goalChance": "Chance of a goal",
  "reveal.before": "Before",
  "reveal.yours": "Yours",
  "reveal.best": "Best",
  "reveal.beat": "You beat the machine",
  "reveal.continue": "Back to the match",
  "reveal.replay": "Replay on the pitch",
  "reveal.view.yours": "Your move",
  "reveal.view.best": "Best move",
  "reveal.replayAgain": "Play the best move again",
  "board.kicker": "Leaderboard",
  "board.teamAvg": "{team} fans · avg {avg}",
  "end.kicker": "Full time",
  "end.rank": "You finished #{rank} of {n} with {pts} points.",
  "end.next": "Next match in {s} s",
  "badge.beat_machine": "Beat the machine",
  "badge.wall": "The Wall",
  "badge.visionary": "Visionary",
  "badge.player_of_the_match": "Player of the match",
  "ack.rules": "Not accepted: a rule is broken.",
  "ack.late": "Too late: the moment had already closed.",
  "challenge.illegalDropped": "Players breaking a rule stay in their original spot.",
  "common.close": "Close",

  // Onboarding: fan profile + team selection (xT Live Challenge)
  "onboarding.kicker": "xT Live Challenge",
  "onboarding.step": "Step {n} of {total}",
  "fanProfile.title": "Create your fan profile",
  "fanProfile.editTitle": "Edit your fan profile",
  "fanProfile.desc": "No sign-up needed: your profile stays on this device.",
  "fanProfile.nickname": "Nickname",
  "fanProfile.nicknamePlaceholder": "e.g. TikiTaka10",
  "fanProfile.nicknameHint": "2 to 20 characters. Shown on the live leaderboard.",
  "fanProfile.nicknameTooShort": "Your nickname needs at least 2 characters.",
  "fanProfile.nicknameTooLong": "Your nickname can be 20 characters at most.",
  "fanProfile.languageHint": "Interface and commentary language.",
  "fanProfile.audienceHint": "Who the pundits talk to during the match.",
  "fanProfile.continue": "Continue",
  "fanProfile.save": "Save profile",
  "fanProfile.cancel": "Cancel",
  "team.title": "Who are you supporting?",
  "team.desc":
    "Pick your side for this match. When play pauses, you boost their attack or shut down the rival's to score points.",
  "team.greeting": "Hi, {name}",
  "team.home": "Home",
  "team.away": "Away",
  "team.fans.one": "{n} fan",
  "team.fans.other": "{n} fans",
  "team.yourTeam": "Your team",
  "team.pickFirst": "Pick a team to start.",
  "team.start": "Start match",
  "team.resume": "Back to match",
  "team.editProfile": "Edit profile",
  "fan.badgeTitle": "Change team or edit your profile",
};

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "header.syntheticData": "Datos sintéticos",
  "header.simulated": "Escenario simulado",
  "header.original": "Jugada original",
  "nav.panel": "Panel",
  "nav.panelTitle": "Mostrar / ocultar el panel táctico",
  "nav.compare": "Comparar",
  "nav.compareTitle": "Comparar dos hipótesis contrafácticas",
  "nav.infra": "Infraestructura",
  "nav.infraTitle": "Telemetría de Azure Container Apps y AKS",
  "nav.guideTitle": "Guía rápida de demostración",
  "nav.guideAria": "Guía rápida",
  "nav.export": "Exportar",
  "nav.exportTitle": "Exportar el informe táctico en PNG",

  "profile.language": "Idioma",
  "profile.audience": "Público",
  "profile.audienceTitle": "A quién hablan los comentaristas",
  "audience.casual": "Aficionado",
  "audience.analyst": "Analista",
  "audience.coach": "Entrenador",
  "audience.audio_description": "Audiodescripción",
  "audience.casual.desc": "Lenguaje sencillo, sin tecnicismos",
  "audience.analyst.desc": "Métricas completas: xT, probabilidad de pase, Voronoi",
  "audience.coach.desc": "Veredicto y consignas de entrenamiento",
  "audience.audio_description.desc": "Narración espacial y hablada para personas ciegas o con baja visión",

  "dock.quickScenarios": "Escenarios rápidos",
  "preset.press": "{name} presiona al poseedor",
  "preset.cut": "{name} cierra la línea de pase",
  "preset.run": "{name} ataca la espalda de la defensa",

  "coach.radius": "radio ≤ 6.0 m",
  "coach.desc": "Recoloca a los dos defensores más cercanos para minimizar el xT rival.",
  "coach.optimise": "Optimizar defensa",
  "coach.optimising": "Optimizando…",
  "coach.restore": "Restaurar posiciones originales",
  "coach.badge": "{count} configuraciones · {ms} ms",

  "xt.simulated": "Simulado",
  "xt.original": "Original",
  "xt.reset": "Restablecer jugada original",
  "xt.export": "Exportar informe táctico",
  "xt.originalXt": "xT original",
  "xt.simulatedXt": "xT simulado",
  "xt.unchanged": "Sin cambios respecto a la jugada original.",
  "xt.more": "El cambio genera más peligro.",
  "xt.less": "El cambio reduce el peligro.",
  "xt.territory": "Control territorial",
  "xt.pass": "Probabilidad de pase",

  "card.programme": "Análisis táctico",
  "card.recalculating": "Recalculando la rejilla xT 16×12 y preparando el análisis…",
  "card.comment.one": "{n} intervención",
  "card.comment.other": "{n} intervenciones",
  "card.listen": "Escuchar",
  "card.stop": "Detener",
  "card.show": "Mostrar análisis",
  "card.hide": "Ocultar análisis",
  "card.pundits": "Comentaristas",
  "card.onAir": "En antena",
  "card.inFocus": "En foco",
  "role.data_scientist": "Analista de datos",
  "role.classic_coach": "Analista táctico",

  "playback.previous": "Jugada anterior",
  "playback.next": "Siguiente jugada",
  "playback.play": "Reproducir",
  "playback.pause": "Pausar",
  "playback.moment": "Jugada clave",
  "playback.timeline": "Línea de tiempo del partido",
  "playback.speed": "Velocidad",
  "playback.reset": "Restablecer jugada",
  "playback.resetTitle": "Restablecer las posiciones originales de la jugada",

  "pitch.title": "Pizarra táctica",
  "pitch.subtitle": "Datos sintéticos · 120 × 80 m",
  "pitch.layers": "Capas",
  "layer.voronoi": "Voronoi",
  "layer.xt": "Rejilla xT",
  "layer.pass": "Líneas de pase",
  "layer.ghost": "Desplazamientos",
  "pitch.inertiaOver": "INERCIA > 6 M · PENALIZACIÓN",
  "pitch.inertiaOk": "DENTRO DEL RADIO",
  "pitch.origin": "ORIGEN",
  "pitch.target": "DESTINO",
  "pitch.bestOption": "OPCIÓN ÓPTIMA",
  "pitch.newPass": "PASE NUEVO",
  "pitch.hint": "Arrastra a cualquier jugador para simular el escenario.",
  "pitch.bestPass": "Pase óptimo",
  "pitch.cellXt": "xT celda",
  "pitch.zone": "Zona",
  "pitch.zoom": "Zoom",
  "pitch.full": "Campo completo",
  "pitch.viewAria": "Vista del campo",
  "pitch.offside": "LÍNEA DE FUERA DE JUEGO",

  // xT Live Challenge
  "challenge.kicker": "Reto xT en directo",
  "challenge.play": "Jugar esta jugada",
  "challenge.playAria": "Jugar esta jugada: {mode}. {s} segundos para mover hasta {n} jugadores.",
  "challenge.possession": "Posesión: {team}",
  "challenge.playMeta": "{s} s · hasta {n} jugadores · {r} m cada uno",
  "challenge.mode.attack": "Ataque",
  "challenge.mode.defend": "Defensa",
  "challenge.goal.attack": "Aumenta el peligro",
  "challenge.goal.defend": "Reduce el peligro",
  "challenge.task.attack": "Recoloca a los compañeros del poseedor en mejores posiciones.",
  "challenge.task.defend": "Recoloca a tus defensores para cortar el peligro.",
  "challenge.time": "Tiempo",
  "challenge.timeAria": "Quedan {s} segundos",
  "challenge.tenSeconds": "Quedan 10 segundos",
  "challenge.timeUp": "Se acabó el tiempo: tus movimientos se han enviado.",
  "challenge.moves": "Movimientos",
  "challenge.trend": "Tendencia",
  "challenge.trend.better": "Mejor",
  "challenge.trend.worse": "Peor",
  "challenge.trend.same": "Sin cambios",
  "challenge.trendAria.better": "Tendencia: mejor para tu equipo",
  "challenge.trendAria.worse": "Tendencia: peor para tu equipo",
  "challenge.trendAria.same": "Tendencia: sin cambios",
  "challenge.checking": "Comprobando…",
  "challenge.offline": "Sin conexión: la tendencia no está disponible",
  "challenge.rules": "Hasta {n} jugadores · radio de {r} m · {d} m de separación",
  "challenge.offsideHint": "Línea discontinua: fuera de juego. Los compañeros en posición legal no pueden cruzarla.",
  "challenge.limit": "Solo puedes mover {n} jugadores. Restablece para elegir otros.",
  "challenge.locked": "Solo se pueden mover los jugadores con aro verde.",
  "challenge.violations": "Infracciones",
  "challenge.illegalNote": "Corrígelas antes de confirmar.",
  "challenge.rule.too_far": "Demasiado lejos",
  "challenge.rule.too_many": "Demasiados jugadores",
  "challenge.rule.not_movable": "No se puede mover",
  "challenge.rule.off_pitch": "Fuera del campo",
  "challenge.rule.too_close": "Demasiado cerca",
  "challenge.rule.offside": "Fuera de juego",
  "challenge.rule.unknown_player": "Jugador desconocido",
  "challenge.reset": "Restablecer",
  "challenge.confirm": "Confirmar",
  "challenge.leave": "Salir del reto",
  "challenge.yourMoves": "Tus movimientos",
  "challenge.noMoves": "Sin movimientos: has mantenido la colocación original.",
  "challenge.revealSoon": "El resultado se desvela cuando se cierre la jugada.",
  "challenge.back": "Volver al análisis",
  "challenge.hint": "Arrastra a un jugador con aro verde: hasta {n}, a un máximo de {r} m.",
  "challenge.delivery.sending": "Enviando tus movimientos…",
  "challenge.delivery.reconnecting": "Se ha perdido la conexión. Tus movimientos se enviarán en cuanto vuelva.",
  "challenge.delivery.received": "El partido ha recibido tus movimientos.",
  "challenge.delivery.failed": "Tus movimientos no han contado: {reason}",
  "challenge.delivery.reason.closed": "la jugada ya se había cerrado.",
  "challenge.delivery.reason.late": "llegaron después de cerrarse la ventana.",
  "challenge.delivery.reason.rules": "un movimiento incumplía las reglas.",
  "challenge.delivery.reason.invalid": "no se pudo leer el mensaje.",
  "sound.mute": "Silenciar efectos de sonido",
  "sound.unmute": "Activar efectos de sonido",
  "zone.box": "Área rival",
  "zone.zone14": "Zona 14 (boca del área)",
  "zone.leftHalfSpace": "Medio espacio izquierdo rival",
  "zone.rightHalfSpace": "Medio espacio derecho rival",
  "zone.leftFlank": "Carril exterior izquierdo",
  "zone.rightFlank": "Carril exterior derecho",
  "zone.ownHalf": "Campo propio",
  "zone.centralAttack": "Zona ofensiva central",

  "guide.kicker": "Guía rápida · 60 s",
  "guide.title": "Cómo usar xT-WhatIf",
  "guide.desc": "Flujo recomendado para una demostración en directo.",
  "guide.footer": "Datos sintéticos · Azure",
  "guide.start": "Empezar",
  "guide.step1.title": "Elige una jugada clave",
  "guide.step1.desc":
    "Selecciona uno de los momentos clave del partido sintético (un contraataque, un pase atrás, un mano a mano…) en el selector del dock inferior.",
  "guide.step2.title": "Reproduce la secuencia",
  "guide.step2.desc":
    "Pulsa Play para ver el recorrido del balón y las micro-carreras de 1,5 a 3,5 m: receptores atacando el espacio y defensores basculando.",
  "guide.step3.title": "Arrastra a un defensor",
  "guide.step3.desc":
    "Fíjate en el anillo de inercia de 6,0 m: si lo superas se marca en magenta y se penaliza el xT. Observa el Δ xT y la línea verde hacia la opción de pase óptima.",
  "guide.step4.title": "Elige idioma y público",
  "guide.step4.desc":
    "Arriba a la derecha puedes cambiar entre inglés y español y elegir a quién hablan los comentaristas: aficionados, analistas, entrenadores o audiodescripción.",
  "guide.step5.title": "Escucha el análisis y exporta",
  "guide.step5.desc":
    "El lower-third resume la lectura del Dr. Voronoi y de Míster Bianchi e ilumina a los jugadores citados. Usa Exportar para descargar el informe en PNG.",

  "export.kicker": "Exportar",
  "export.title": "Informe táctico",
  "export.desc": "Pizarra, métricas de xT y lectura de los analistas en un PNG de 1600 × 1200.",
  "export.ready": "Listo para compartir con el cuerpo técnico.",
  "export.cancel": "Cancelar",
  "export.download": "Descargar PNG",
  "export.downloaded": "Descargado",
  "export.generating": "Generando informe…",
  "export.alt": "Vista previa del informe táctico",
  "export.failed": "No se pudo generar el informe.",
  "report.ident": "ANÁLISIS TÁCTICO",
  "report.header": "xT/WHATIF · INFORME TÁCTICO · {date}",
  "report.synthetic": "DATOS SINTÉTICOS",
  "report.simulated": "ESCENARIO SIMULADO",
  "report.original": "JUGADA ORIGINAL",
  "report.originalXt": "xT REAL",
  "report.simulatedXt": "xT SIMULADO",
  "report.territory": "CONTROL TERRITORIAL",
  "report.pass": "PROBABILIDAD DE PASE",
  "report.dsFallbackHeadline": "Optimización de corredor xT",
  "report.dsFallbackBody": "La alteración de la posición genera variaciones significativas en el Expected Threat de recepción.",
  "report.coachFallbackHeadline": "Criterio de vestuario y basculación",
  "report.coachFallbackBody": "Ningún central retrocede tanto sin romper el achique. El rigor táctico manda.",
  "report.footer":
    "xT-WhatIf © 2026 · Inteligencia táctica contrafactual · Datos sintéticos · Teselación de Voronoi · Penalización de inercia r = 6,0 m",

  "compare.kicker": "Comparador",
  "compare.title": "Escenario A vs B",
  "compare.desc": "Guarda dos hipótesis y compara la reducción de peligro frente al esfuerzo físico.",
  "compare.verdict": "Veredicto",
  "compare.pinBoth": "Fija ambos escenarios para comparar su eficiencia táctica.",
  "compare.winner": "El escenario {key} es más eficiente ({ratio} ΔxT/m): reduce más peligro por metro recorrido.",
  "compare.tie": "Ambos escenarios tienen el mismo perfil de riesgo/recompensa.",
  "compare.scenario": "Escenario {key}",
  "compare.moreEfficient": "Más eficiente",
  "compare.threat": "Amenaza (xT)",
  "compare.control": "Control Voronoi",
  "compare.passSuccess": "Éxito de pase",
  "compare.totalDisplacement": "Desplazamiento total",
  "compare.restore": "Restaurar en la pizarra",
  "compare.empty": "Mueve jugadores y pulsa «Fijar {key}».",
  "compare.onBoard": "En la pizarra: {n} jugadores modificados",
  "compare.pin": "Fijar {key}",
  "compare.original": "Original",
  "compare.unchanged": "Jugada sin cambios",
  "compare.baseThreat": "Amenaza base (xT)",
  "compare.displacement": "Desplazamiento",

  "cloud.kicker": "Infraestructura",
  "cloud.title": "Telemetría cloud",
  "cloud.desc": "Arquitectura dual-role: gateway en ACA, workers en AKS y agentes en AI Foundry.",
  "cloud.refresh": "Actualizar telemetría",
  "cloud.close": "Cerrar",
  "cloud.services": "Servicios",
  "cloud.breakerOpen": "Circuit breaker abierto",
  "cloud.operational": "Operativo",
  "cloud.down": "Caído",
  "cloud.acaDetail": "Gateway público · WebSocket · Circuit breaker · KEDA 1–10 réplicas",
  "cloud.replicas": "Réplicas",
  "cloud.aksDown": "Fallo inyectado. El tráfico se resuelve en el gateway.",
  "cloud.aksDetail": "Cómputo Voronoi + xT · HPA 3–12 pods",
  "cloud.agents": "gpt-4o · 2 agentes",
  "cloud.agentsDetail": "Debate entre Dr. Voronoi (datos) y Míster Bianchi (táctica)",
  "cloud.model": "Modelo",
  "cloud.latency": "Latencia",
  "cloud.lastCalc": "Último cálculo",
  "cloud.cacheNote": "Caché LRU en memoria",
  "cloud.simulations": "Simulaciones",
  "cloud.simulationsNote": "Escenarios calculados",
  "cloud.breakerNote": "Conmutaciones a local",
  "cloud.performance": "Rendimiento",
  "cloud.live": "Pruebas en directo",
  "cloud.liveDesc":
    "Mide el rendimiento del motor geométrico y comprueba cómo responde el circuit breaker ante un fallo inyectado.",
  "cloud.bursting": "Calculando 25 simulaciones…",
  "cloud.burst": "Lanzar ráfaga de 25 simulaciones",
  "cloud.restoreAks": "Restablecer AKS",
  "cloud.killAks": "Simular caída de AKS",
  "cloud.burstDone": "Ráfaga de {n} simulaciones completada",
  "cloud.burstStats": "Total {total} ms · media {avg} ms/sim · {lookups} consultas espaciales",
  "cloud.chaosOn":
    "Fallo de AKS inyectado → circuit breaker abierto en el gateway de ACA → cómputo local de respaldo operativo (0% de pérdida de paquetes)",
  "cloud.chaosOff": "Operación normal restablecida: clúster AKS saludable y sincronizado.",
  "cloud.simulatedNote": "Las cifras de réplicas, pods y CPU se simulan a partir de la carga de peticiones para la demo.",

  "live.kicker": "Partido en directo",
  "live.connecting": "Conectando con el partido en directo…",
  "live.waitingMoment": "El próximo reto se abrirá en una jugada clave del partido.",
  "live.ticker": "Últimas jugadas",
  "live.fans": "{n} aficionados jugando",
  "live.practice": "Practicar las jugadas clave",
  "live.backToLive": "Volver al directo",
  "live.offline": "Directo no disponible: practica las jugadas clave.",
  "live.outcome.completed": "Hecho",
  "live.outcome.intercepted": "Perdido",
  "live.outcome.goal": "Gol",
  "live.outcome.saved": "Parada",
  "live.outcome.missed": "Fuera",
  "live.outcome.blocked": "Bloqueado",
  "reveal.kicker": "Resultado",
  "reveal.yourScore": "Tu puntuación",
  "reveal.goalChance": "Probabilidad de gol",
  "reveal.before": "Antes",
  "reveal.yours": "Tuya",
  "reveal.best": "Óptima",
  "reveal.beat": "Has superado a la máquina",
  "reveal.continue": "Volver al partido",
  "reveal.replay": "Repetición en el campo",
  "reveal.view.yours": "Tu jugada",
  "reveal.view.best": "Jugada óptima",
  "reveal.replayAgain": "Repetir la jugada óptima",
  "board.kicker": "Clasificación",
  "board.teamAvg": "Afición {team} · media {avg}",
  "end.kicker": "Final del partido",
  "end.rank": "Has terminado en el puesto {rank} de {n} con {pts} puntos.",
  "end.next": "Siguiente partido en {s} s",
  "badge.beat_machine": "Mejor que la máquina",
  "badge.wall": "La Muralla",
  "badge.visionary": "Visionario",
  "badge.player_of_the_match": "Jugador del partido",
  "ack.rules": "No aceptado: se incumple una regla.",
  "ack.late": "Demasiado tarde: la jugada ya se había cerrado.",
  "challenge.illegalDropped": "Los jugadores que incumplen una regla se quedan en su sitio.",
  "common.close": "Cerrar",

  "onboarding.kicker": "xT Live Challenge",
  "onboarding.step": "Paso {n} de {total}",
  "fanProfile.title": "Crea tu perfil de aficionado",
  "fanProfile.editTitle": "Edita tu perfil de aficionado",
  "fanProfile.desc": "Sin registro: tu perfil se guarda solo en este dispositivo.",
  "fanProfile.nickname": "Apodo",
  "fanProfile.nicknamePlaceholder": "p. ej. TikiTaka10",
  "fanProfile.nicknameHint": "Entre 2 y 20 caracteres. Aparecerá en la clasificación en directo.",
  "fanProfile.nicknameTooShort": "Tu apodo debe tener al menos 2 caracteres.",
  "fanProfile.nicknameTooLong": "Tu apodo puede tener como máximo 20 caracteres.",
  "fanProfile.languageHint": "Idioma de la interfaz y de los comentarios.",
  "fanProfile.audienceHint": "A quién se dirigen los comentaristas durante el partido.",
  "fanProfile.continue": "Continuar",
  "fanProfile.save": "Guardar perfil",
  "fanProfile.cancel": "Cancelar",
  "team.title": "¿Con quién vas?",
  "team.desc":
    "Elige tu equipo para este partido. Cuando se pare el juego, potencia su ataque o frena el del rival para sumar puntos.",
  "team.greeting": "Hola, {name}",
  "team.home": "Local",
  "team.away": "Visitante",
  "team.fans.one": "{n} aficionado",
  "team.fans.other": "{n} aficionados",
  "team.yourTeam": "Tu equipo",
  "team.pickFirst": "Elige un equipo para empezar.",
  "team.start": "Empezar partido",
  "team.resume": "Volver al partido",
  "team.editProfile": "Editar perfil",
  "fan.badgeTitle": "Cambiar de equipo o editar tu perfil",
};

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, es };

/** BCP 47 locale used for dates, numbers and speech synthesis. */
export const LOCALES: Record<Language, string> = { en: "en-GB", es: "es-ES" };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Language, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[lang][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

interface I18nContextValue {
  language: Language;
  audience: Audience;
  setLanguage: (lang: Language) => void;
  setAudience: (audience: Audience) => void;
  t: Translate;
  locale: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "xt-whatif.profile";

function readStoredProfile(): { language?: Language; audience?: Audience } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      language: LANGUAGES.includes(parsed.language) ? parsed.language : undefined,
      audience: AUDIENCES.includes(parsed.audience) ? parsed.audience : undefined,
    };
  } catch {
    return {};
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [audience, setAudience] = useState<Audience>(DEFAULT_AUDIENCE);
  const [hydrated, setHydrated] = useState(false);

  // The remembered profile is a per-viewer convenience: restore it after the first render.
  useEffect(() => {
    const stored = readStoredProfile();
    if (stored.language) setLanguage(stored.language);
    if (stored.audience) setAudience(stored.audience);
    setHydrated(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ language, audience }));
    } catch {
      // Storage blocked (private mode): the profile simply is not remembered.
    }
  }, [language, audience, hydrated]);

  const t = useCallback<Translate>((key, vars) => translate(language, key, vars), [language]);

  const value = useMemo(
    () => ({ language, audience, setLanguage, setAudience, t, locale: LOCALES[language] }),
    [language, audience, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
