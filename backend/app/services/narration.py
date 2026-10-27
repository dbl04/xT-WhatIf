"""
Localised narration for the two pundits (personalisation: language x audience).

Every text the agents say is built here from the engine's numbers, so the deterministic
fallback, the pre-move reading of each moment and the LLM prompt share one source.

- Languages: English ("en", default) and Spanish ("es").
- Audiences:
    casual            plain words, no jargon; xT is told as "chance of leading to a goal".
    analyst           full metrics (xT, pass probability, Voronoi control). Default.
    coach             actionable coaching points and a verdict on the adjustment.
    audio_description spatial, spoken-first narration for blind and low-vision fans.
"""

from __future__ import annotations

import math
import uuid
from typing import Any, Dict, List, Literal, Optional, Tuple

from app.schemas.match_contract import AgentMessage, AgentRole, MatchFramePayload, PlayerNode

Language = Literal["en", "es"]
Audience = Literal["casual", "analyst", "coach", "audio_description"]

LANGUAGES: tuple = ("en", "es")
AUDIENCES: tuple = ("casual", "analyst", "coach", "audio_description")
DEFAULT_LANGUAGE: Language = "en"
DEFAULT_AUDIENCE: Audience = "analyst"


def normalize_language(value: Optional[str]) -> Language:
    return value if value in LANGUAGES else DEFAULT_LANGUAGE  # type: ignore[return-value]


def normalize_audience(value: Optional[str]) -> Audience:
    return value if value in AUDIENCES else DEFAULT_AUDIENCE  # type: ignore[return-value]


AGENT_NAMES: Dict[str, Dict[AgentRole, str]] = {
    "en": {
        AgentRole.DATA_SCIENTIST: "Dr. Voronoi (Data Scientist)",
        AgentRole.CLASSIC_COACH: "Coach Bianchi (Classic Coach)",
    },
    "es": {
        AgentRole.DATA_SCIENTIST: "Dr. Voronoi (Científico de datos)",
        AgentRole.CLASSIC_COACH: "Míster Bianchi (Entrenador clásico)",
    },
}
BADGES = {AgentRole.DATA_SCIENTIST: "AI-QUANT", AgentRole.CLASSIC_COACH: "PRO-COACH"}
SIMULATION_TAG = {"en": "SIMULATION", "es": "SIMULACIÓN"}

# Key moments of the synthetic generator (Scenario.key -> label).
MOMENT_LABELS: Dict[str, Dict[str, str]] = {
    "wide_carry": {"en": "Wide carry into the box", "es": "Conducción por banda hacia el área"},
    "counter_through": {"en": "Counter-attack: ball into space", "es": "Contraataque: pase al espacio"},
    "cutback": {"en": "Cut-back from the byline", "es": "Pase atrás desde la línea de fondo"},
    "half_space": {"en": "Through ball into the half-space", "es": "Pase filtrado al pasillo interior"},
    "switch": {"en": "Switch of play to the far side", "es": "Cambio de orientación a la banda contraria"},
    "edge_shot": {"en": "Shot from the edge of the box", "es": "Disparo desde la frontal del área"},
    "one_v_one": {"en": "One-on-one with the keeper", "es": "Mano a mano con el portero"},
    # Ordinary events of a full live match (never opened as challenges).
    "buildup_pass": {"en": "Build-up pass", "es": "Pase en la salida"},
    "progressive_pass": {"en": "Pass forward", "es": "Pase hacia delante"},
    "carry": {"en": "Ball carry", "es": "Conducción"},
}


def moment_label(key: Optional[str], lang: Language, fallback: Optional[str] = None) -> Optional[str]:
    if key and key in MOMENT_LABELS:
        return MOMENT_LABELS[key][lang]
    return fallback


# ---------------------------------------------------------------------------
# Spatial description (audio description and casual audiences)
# ---------------------------------------------------------------------------
_LANES = {
    "en": ("on the right wing", "in the right half-space", "through the middle",
           "in the left half-space", "on the left wing"),
    "es": ("por la banda derecha", "en el carril interior derecho", "por el centro",
           "en el carril interior izquierdo", "por la banda izquierda"),
}


def describe_spot(x: float, y: float, lang: Language) -> str:
    """Where a point is, seen by the attacking team (it attacks x = 120; y < 40 is its right)."""
    goal_dist = math.hypot(120.0 - x, 40.0 - y)
    metres = max(5, int(round(goal_dist / 5.0) * 5))
    if x >= 102.0 and 18.0 <= y <= 62.0:
        return "inside the penalty area" if lang == "en" else "dentro del área"
    if x < 60.0:
        return "in their own half" if lang == "en" else "en su propio campo"
    lanes = _LANES[lang]
    lane = lanes[0] if y < 18 else lanes[1] if y < 30 else lanes[2] if y <= 50 else lanes[3] if y <= 62 else lanes[4]
    if lang == "en":
        return f"{lane}, about {metres} metres from goal"
    return f"{lane}, a unos {metres} metros de la portería"


def _pct(xt: float) -> int:
    """xT is the probability that possession ends in a goal: shown as a whole percentage."""
    return int(round(xt * 100))


# ---------------------------------------------------------------------------
# Counterfactual debate templates: TEMPLATES[lang][audience][role][case]
# case: "down" (threat falls), "up" (threat rises), "flat" (no change)
# Each entry is (headline, body, referenced_metric).
# ---------------------------------------------------------------------------
DS, CO = AgentRole.DATA_SCIENTIST, AgentRole.CLASSIC_COACH

TEMPLATES: Dict[str, Dict[str, Dict[AgentRole, Dict[str, tuple]]]] = {
    "en": {
        "analyst": {
            DS: {
                "down": (
                    "Expected threat drops by {pct}%",
                    "Shifting {mod} {dist} m closes the passing lane to {receiver}. "
                    "xT falls from {orig} to {sim} and pass completion drops to {prob}%.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "up": (
                    "Attacking threat rises ({delta} xT)",
                    "{mod}'s move opens a direct corridor worth {sim} xT. "
                    "Pass completion climbs to {prob}% and local space control reaches {ctrl}%.",
                    "ΔxT: {delta} | Control: {ctrl}%",
                ),
                "flat": (
                    "Threat stays neutral at {sim} xT",
                    "Repositioning {mod} keeps threat at {sim} xT. "
                    "Pass completion stays at {prob}% with no major shift in space control.",
                    "xT: {sim} | Pass prob.: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "You cover the pass to {receiver}, but watch the inside lane",
                    "Dropping {mod} kills the ball down the outside, but watch the gap between "
                    "centre-back and full-back if they thread it inside to {optimal}.",
                    "Defensive gap towards {optimal}",
                ),
                "up": (
                    "Sharp vertical run; watch the cover shift",
                    "Great movement dragging markers. If the ball goes early to {optimal} we have "
                    "numbers in the box, though the holding midfielder must cover the counter.",
                    "Cover shift required",
                ),
                "flat": (
                    "Good position, but needs tighter pressure",
                    "{mod} holds the line but stays too far off. Close the distance before "
                    "{optimal} can turn and face goal.",
                    "Pressing distance > 2.0 m",
                ),
            },
        },
        "casual": {
            DS: {
                "down": (
                    "That move cuts the danger by {pct}%",
                    "Moving {mod} {dist} metres blocks the route to {receiver}. Goal danger drops "
                    "from {orig_pct}% to {sim_pct}%, and the pass only has a {prob}% chance of arriving.",
                    "Goal threat: {orig_pct}% → {sim_pct}%",
                ),
                "up": (
                    "This makes the attack more dangerous",
                    "With {mod} in the new spot, goal danger rises from {orig_pct}% to {sim_pct}%, "
                    "and the pass is {prob}% likely to arrive.",
                    "Goal threat: {orig_pct}% → {sim_pct}%",
                ),
                "flat": (
                    "Not much changes",
                    "Moving {mod} keeps the danger around {sim_pct}%, with the pass {prob}% likely to arrive.",
                    "Goal threat: {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Good block, but watch the middle",
                    "{mod} shuts the obvious pass, though a quick ball inside to {optimal} could still hurt us.",
                    "Watch out for {optimal}",
                ),
                "up": (
                    "Great run: the defence is pulled apart",
                    "That run drags defenders away. Get the ball to {optimal} quickly and we are in.",
                    "Key player: {optimal}",
                ),
                "flat": (
                    "Right place, but too passive",
                    "{mod} is in position but needs to get tighter so {optimal} cannot turn.",
                    "Get closer to {optimal}",
                ),
            },
        },
        "coach": {
            DS: {
                "down": (
                    "Validated: threat down {pct}%",
                    "Moving {mod} {dist} m lowers xT from {orig} to {sim} and cuts the pass to "
                    "{receiver} to {prob}% completion.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "up": (
                    "Rejected: adjustment adds {delta} xT",
                    "With {mod} moved, xT rises from {orig} to {sim} and pass completion reaches {prob}%. "
                    "Pick another defender to close the space.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "flat": (
                    "No measurable gain",
                    "{mod}'s new spot leaves xT at {sim} and pass completion at {prob}%. "
                    "Use the move on a defender closer to the ball.",
                    "xT: {sim} | Pass prob.: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Keep {mod} there and cover inside",
                    "{mod} screens the pass to {receiver}; slide the midfielder 3 m inside to deny {optimal}.",
                    "Cover the lane to {optimal}",
                ),
                "up": (
                    "Undo it, the defensive line breaks",
                    "That position frees {optimal}. Hold the line with the centre-back and press with the full-back.",
                    "Hold the line",
                ),
                "flat": (
                    "Step in tighter on the receiver",
                    "Position is fine, intensity is not. {mod} must close to under 2 m before {optimal} receives.",
                    "Pressing distance < 2 m",
                ),
            },
        },
        "audio_description": {
            DS: {
                "down": (
                    "The defence closes the route to {receiver}",
                    "{mod} moves {dist} metres and ends up {mod_spot}, blocking the pass to {receiver}. "
                    "Goal danger falls from {orig_pct} to {sim_pct} percent.",
                    "Goal threat {orig_pct}% to {sim_pct}%",
                ),
                "up": (
                    "The attack finds more space",
                    "{mod} moves {dist} metres and ends up {mod_spot}. Goal danger rises from {orig_pct} "
                    "to {sim_pct} percent, with a {prob} percent pass chance.",
                    "Goal threat {orig_pct}% to {sim_pct}%",
                ),
                "flat": (
                    "The picture stays the same",
                    "{mod} moves {dist} metres and ends up {mod_spot}. Goal danger stays at about {sim_pct} percent.",
                    "Goal threat {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Space opens on the inside",
                    "With {mod} pulled across, {optimal} is free {optimal_spot}, waiting for a pass through the middle.",
                    "Free player: {optimal}",
                ),
                "up": (
                    "Defenders are dragged out of position",
                    "The run pulls defenders towards the ball, leaving {optimal} unmarked {optimal_spot}.",
                    "Free player: {optimal}",
                ),
                "flat": (
                    "The defender holds position but stays off",
                    "{mod} stands {mod_spot}, a few steps away from {optimal}, who can still receive and turn.",
                    "Closest threat: {optimal}",
                ),
            },
        },
    },
    "es": {
        "analyst": {
            DS: {
                "down": (
                    "El peligro esperado cae un {pct}%",
                    "Desplazar a {mod} {dist} metros cierra la línea de pase hacia {receiver}. "
                    "El xT baja de {orig} a {sim} y la probabilidad de pase cae al {prob}%.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "up": (
                    "Aumenta la amenaza ofensiva ({delta} xT)",
                    "El movimiento de {mod} abre un pasillo directo de {sim} xT. "
                    "La probabilidad de pase sube al {prob}% y el control del espacio llega al {ctrl}%.",
                    "ΔxT: {delta} | Control: {ctrl}%",
                ),
                "flat": (
                    "Amenaza neutra en {sim} xT",
                    "El ajuste de {mod} mantiene la amenaza en {sim} xT y la probabilidad de pase en {prob}%.",
                    "xT: {sim} | Prob. pase: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Tapas a {receiver}, pero vigila por dentro",
                    "El retroceso de {mod} corta el pase exterior, pero cuidado si filtran por dentro hacia {optimal}.",
                    "Intervalo abierto hacia {optimal}",
                ),
                "up": (
                    "Buen desmarque vertical; ojo a la vigilancia",
                    "Gran movimiento arrastrando marcas: si el balón llega rápido a {optimal} creamos peligro claro.",
                    "Basculación defensiva requerida",
                ),
                "flat": (
                    "Buena posición, pero falta apretar la marca",
                    "{mod} aguanta la línea pero no incomoda. Hay que encimar antes de que {optimal} reciba girado.",
                    "Distancia de acoso > 2.0 m",
                ),
            },
        },
        "casual": {
            DS: {
                "down": (
                    "Ese movimiento reduce el peligro un {pct}%",
                    "Mover a {mod} {dist} metros tapa el pase a {receiver}. El peligro de gol baja del "
                    "{orig_pct}% al {sim_pct}%, y el pase queda en un {prob}% de éxito.",
                    "Peligro de gol: {orig_pct}% → {sim_pct}%",
                ),
                "up": (
                    "Así el ataque es más peligroso",
                    "Con {mod} en esa posición, el peligro de gol sube del {orig_pct}% al {sim_pct}% y el pase "
                    "tiene un {prob}% de llegar.",
                    "Peligro de gol: {orig_pct}% → {sim_pct}%",
                ),
                "flat": (
                    "Apenas cambia nada",
                    "Mover a {mod} deja el peligro parecido, en torno al {sim_pct}% de acabar en gol.",
                    "Peligro de gol: {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Buen bloqueo, pero queda hueco por dentro",
                    "{mod} tapa el pase claro, aunque un balón filtrado a {optimal} todavía puede hacernos daño.",
                    "Cuidado con {optimal}",
                ),
                "up": (
                    "Gran desmarque que rompe la línea",
                    "Ese movimiento arrastra a los defensas. Si el balón llega rápido a {optimal}, hay ocasión clara.",
                    "Jugador clave: {optimal}",
                ),
                "flat": (
                    "Bien colocado, pero demasiado lejos",
                    "{mod} está en su sitio pero deja pensar. Si no se acerca, {optimal} puede girarse cómodo.",
                    "Acércate a {optimal}",
                ),
            },
        },
        "coach": {
            DS: {
                "down": (
                    "Validado: el peligro baja un {pct}%",
                    "Mover a {mod} {dist} m reduce el xT de {orig} a {sim} y deja el pase a {receiver} en un {prob}%.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "up": (
                    "Descartado: el ajuste suma {delta} xT",
                    "Con {mod} desplazado el xT sube de {orig} a {sim} y el pase sube al {prob}%. "
                    "Conviene elegir otro defensor para cerrar espacio.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "flat": (
                    "Sin ganancia medible",
                    "La nueva posición de {mod} mantiene el xT en {sim} y el pase en {prob}%. "
                    "Mejor ajustar con un defensor más cercano al balón.",
                    "xT: {sim} | Prob. pase: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Consigna: {mod} cierra ahí y basculamos dentro",
                    "{mod} tapa a {receiver}; que el mediocentro cierre 3 m por dentro para vigilar a {optimal}.",
                    "Cerrar la línea hacia {optimal}",
                ),
                "up": (
                    "Consigna: corregir, se abre la línea",
                    "Esa posición libera a {optimal}. Que el central aguante la línea y salte el lateral al balón.",
                    "Mantener la línea",
                ),
                "flat": (
                    "Consigna: acortar distancia de presión",
                    "Buena zona pero poca intensidad. {mod} debe encimar a menos de 2 m antes de que {optimal} gire.",
                    "Distancia de presión < 2 m",
                ),
            },
        },
        "audio_description": {
            DS: {
                "down": (
                    "La defensa cierra el camino hacia {receiver}",
                    "{mod} se mueve {dist} metros y queda {mod_spot}, cortando el pase a {receiver}. "
                    "La probabilidad de gol baja del {orig_pct} al {sim_pct} por ciento.",
                    "Peligro de gol {orig_pct}% a {sim_pct}%",
                ),
                "up": (
                    "El ataque encuentra más espacio",
                    "{mod} se mueve {dist} metros y queda {mod_spot}. La probabilidad de gol sube del "
                    "{orig_pct} al {sim_pct} por ciento, con un {prob} por ciento de éxito en el pase.",
                    "Peligro de gol {orig_pct}% a {sim_pct}%",
                ),
                "flat": (
                    "La situación no cambia",
                    "{mod} se mueve {dist} metros y queda {mod_spot}. La probabilidad de gol sigue en torno al "
                    "{sim_pct} por ciento.",
                    "Peligro de gol {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Se abre espacio por dentro",
                    "Con {mod} desplazado, {optimal} queda libre {optimal_spot} esperando el pase interior.",
                    "Jugador libre: {optimal}",
                ),
                "up": (
                    "Los defensas quedan fuera de sitio",
                    "El desmarque arrastra marcas y deja a {optimal} libre {optimal_spot} frente a portería.",
                    "Jugador libre: {optimal}",
                ),
                "flat": (
                    "El defensor aguanta pero no aprieta",
                    "{mod} está {mod_spot}, a unos pasos de {optimal}, que todavía puede recibir y girarse.",
                    "Amenaza más cercana: {optimal}",
                ),
            },
        },
    },
}

# Pre-move reading of each key moment: BASE_TEMPLATES[lang][audience][role] = (headline, body, metric).
# {optimal_clause} is empty when the carrier is also the best option.
BASE_TEMPLATES: Dict[str, Dict[str, Dict[AgentRole, tuple]]] = {
    "en": {
        "analyst": {
            DS: (
                "{label}: {xt} xT in play",
                "{actor} starts the action at ({ax}, {ay}). The move is worth {xt} xT, with a {prob}% chance of "
                "completing the action and {ctrl}% local space control in the final third.{optimal_clause}",
                "xT: {xt} | Pass prob.: {prob}%",
            ),
            CO: (
                "{presser} presses from {gap} m",
                "{presser} is first to jump and gets within {gap} m of the ball. "
                "Move a defender and check whether you close the lane without opening another.",
                "Pressing distance: {gap} m",
            ),
        },
        "casual": {
            DS: (
                "{label}",
                "{actor} has the ball {actor_spot}. Right now this attack has about a {xt_pct}% chance of "
                "leading to a goal.{optimal_clause}",
                "Goal threat: {xt_pct}%",
            ),
            CO: (
                "{presser} is closing in",
                "{presser} is {gap_m} metres from the ball. Drag a defender and see if you can stop the attack.",
                "Pressure: {gap_m} m away",
            ),
        },
        "coach": {
            DS: (
                "{label}: baseline {xt} xT",
                "Baseline before any adjustment: {xt} xT, {prob}% pass completion and {ctrl}% space control."
                "{optimal_clause}",
                "Baseline xT: {xt}",
            ),
            CO: (
                "Pressing trigger: {presser} at {gap} m",
                "{presser} is the first presser, {gap} m from the ball. Task: pick one defender and close the "
                "lane to the best receiver without breaking the line.",
                "First presser: {gap} m",
            ),
        },
        "audio_description": {
            DS: (
                "{label}",
                "{team} attack towards goal. {actor} has the ball {actor_spot}.{optimal_clause}",
                "Goal threat {xt_pct}%",
            ),
            CO: (
                "{presser} steps out to press",
                "{presser} comes out to meet the ball and stops about {gap_m} metres away. "
                "Behind, the rest of the defence holds its shape.",
                "Nearest defender: {gap_m} m",
            ),
        },
    },
    "es": {
        "analyst": {
            DS: (
                "{label}: {xt} xT en juego",
                "{actor} inicia la acción en ({ax}, {ay}). El valor de la jugada es {xt} xT con un {prob}% de "
                "probabilidad de completar la acción y un control territorial local del {ctrl}% en el último "
                "tercio.{optimal_clause}",
                "xT: {xt} | Prob. pase: {prob}%",
            ),
            CO: (
                "Presión de {presser} a {gap} m",
                "{presser} es el primero en saltar y llega a {gap} m del balón. "
                "Mueve a un defensor y comprueba si cierras el carril sin abrir otro.",
                "Distancia de presión: {gap} m",
            ),
        },
        "casual": {
            DS: (
                "{label}",
                "{actor} lleva el balón {actor_spot}. Ahora mismo esta jugada tiene más o menos un {xt_pct}% de "
                "acabar en gol.{optimal_clause}",
                "Peligro de gol: {xt_pct}%",
            ),
            CO: (
                "{presser} sale a presionar",
                "{presser} está a {gap_m} metros del balón. Arrastra a un defensa y mira si consigues frenar el ataque.",
                "Presión: a {gap_m} m",
            ),
        },
        "coach": {
            DS: (
                "{label}: punto de partida {xt} xT",
                "Punto de partida antes de ajustar: {xt} xT, {prob}% de acierto en el pase y {ctrl}% de control "
                "del espacio.{optimal_clause}",
                "xT de partida: {xt}",
            ),
            CO: (
                "Activador de presión: {presser} a {gap} m",
                "{presser} es el primer presionador, a {gap} m del balón. Tarea: elige un defensor y cierra la "
                "línea hacia el mejor receptor sin romper la línea defensiva.",
                "Primer presionador: {gap} m",
            ),
        },
        "audio_description": {
            DS: (
                "{label}",
                "{team} ataca hacia la portería. {actor} lleva el balón {actor_spot}.{optimal_clause}",
                "Peligro de gol {xt_pct}%",
            ),
            CO: (
                "{presser} sale a presionar",
                "{presser} sale al encuentro del balón y se queda a unos {gap_m} metros. "
                "Detrás, el resto de la defensa mantiene su posición.",
                "Defensor más cercano: {gap_m} m",
            ),
        },
    },
}

OPTIMAL_CLAUSE = {
    "en": {
        "analyst": " The highest-value option is {optimal}.",
        "casual": " The most dangerous option is a pass to {optimal}.",
        "coach": " Highest-value receiver: {optimal}.",
        "audio_description": " The most dangerous pass is to {optimal}, who is {optimal_spot}. "
                             "The chance of a goal is about {xt_pct} percent.",
    },
    "es": {
        "analyst": " La opción de mayor valor esperado es {optimal}.",
        "casual": " La opción más peligrosa es un pase a {optimal}.",
        "coach": " Receptor de mayor valor: {optimal}.",
        "audio_description": " El pase más peligroso es hacia {optimal}, que está {optimal_spot}. "
                             "La probabilidad de gol ronda el {xt_pct} por ciento.",
    },
}

# Fallback names when the engine cannot point at a player.
FALLBACK_NAMES = {
    "en": {"defender": "the defender", "receiver": "the wide receiver", "optimal": "the alternative receiver"},
    "es": {"defender": "el defensor", "receiver": "el receptor en banda", "optimal": "el receptor alternativo"},
}


def _message(role: AgentRole, lang: Language, clock: str, parts: tuple, fields: Dict, ids: List[int],
             message_id: str) -> AgentMessage:
    headline, body, metric = (p.format(**fields) for p in parts)
    return AgentMessage(
        message_id=message_id,
        agent_role=role,
        agent_name=AGENT_NAMES[lang][role],
        avatar_badge=BADGES[role],
        timestamp_label=clock,
        headline=headline,
        analysis_body=body,
        referenced_metric=metric,
        highlighted_player_ids=ids,
    )


def _team_name(frame: MatchFramePayload, lang: Language) -> str:
    info = frame.match_info
    if info is not None:
        return (info.home if frame.possession_team.value == "home" else info.away).name
    if lang == "es":
        return "El equipo local" if frame.possession_team.value == "home" else "El equipo visitante"
    return "The home side" if frame.possession_team.value == "home" else "The away side"


def base_debate(frame: MatchFramePayload, label: str, lang: Language = DEFAULT_LANGUAGE,
                audience: Audience = DEFAULT_AUDIENCE) -> List[AgentMessage]:
    """Deterministic pre-move reading of a moment, written from the computed metrics."""
    m = frame.metrics
    by_id = {p.player_id: p for p in frame.players}
    actor = next(p for p in frame.players if p.is_actor)
    defenders = [p for p in frame.players if p.team != frame.possession_team and not p.is_keeper]
    presser = min(defenders, key=lambda p: math.hypot(p.x - actor.x, p.y - actor.y))
    press_gap = math.hypot(presser.x - actor.x, presser.y - actor.y)
    optimal = by_id.get(m.optimal_pass_target_id) if m.optimal_pass_target_id else None
    clock = f"{frame.minute}:{frame.second:02d}"

    fields = {
        "label": label,
        "actor": actor.name,
        "ax": f"{actor.x:.1f}",
        "ay": f"{actor.y:.1f}",
        "actor_spot": describe_spot(actor.x, actor.y, lang),
        "xt": f"{m.original_xt:.2f}",
        "xt_pct": _pct(m.original_xt),
        "prob": f"{m.pass_completion_prob:.1f}",
        "ctrl": f"{m.space_control_home_pct:.1f}",
        "presser": presser.name,
        "gap": f"{press_gap:.1f}",
        "gap_m": max(1, int(round(press_gap))),
        "team": _team_name(frame, lang),
        "optimal_clause": "",
    }
    if optimal is not None and optimal.player_id != actor.player_id:
        fields["optimal_clause"] = OPTIMAL_CLAUSE[lang][audience].format(
            optimal=optimal.name, optimal_spot=describe_spot(optimal.x, optimal.y, lang), xt_pct=fields["xt_pct"]
        )
    elif audience == "audio_description":
        fields["optimal_clause"] = (
            f" The chance of a goal is about {fields['xt_pct']} percent." if lang == "en"
            else f" La probabilidad de gol ronda el {fields['xt_pct']} por ciento."
        )

    templates = BASE_TEMPLATES[lang][audience]
    namespace = uuid.uuid5(uuid.NAMESPACE_URL, f"xt-whatif/narration/{frame.event_uuid}/{lang}/{audience}")
    highlighted_ds = [actor.player_id] + ([optimal.player_id] if optimal else [])
    return [
        _message(DS, lang, clock, templates[DS], fields, highlighted_ds,
                 f"msg-{str(uuid.uuid5(namespace, 'ds'))[:8]}"),
        _message(CO, lang, clock, templates[CO], fields, [presser.player_id, actor.player_id],
                 f"msg-{str(uuid.uuid5(namespace, 'coach'))[:8]}"),
    ]


def localize_frame(frame: MatchFramePayload, lang: Language = DEFAULT_LANGUAGE,
                   audience: Audience = DEFAULT_AUDIENCE) -> MatchFramePayload:
    """Returns a copy of an untouched key moment with its label and pre-move debate in `lang`/`audience`."""
    label = moment_label(frame.moment_key, lang, frame.moment_label) or frame.event_type
    localized = frame.model_copy(deep=True)
    localized.moment_label = label
    localized.agent_debate = base_debate(localized, label, lang, audience)
    return localized


def _receiver(frame: MatchFramePayload, actor: PlayerNode) -> Optional[PlayerNode]:
    if frame.ball_end_x is None or frame.ball_end_y is None:
        return None
    mates = [p for p in frame.players if not p.is_actor and p.team == frame.possession_team]
    if not mates:
        return None
    return min(mates, key=lambda p: math.hypot(p.x - frame.ball_end_x, p.y - frame.ball_end_y))


def delta_context(frame: MatchFramePayload, lang: Language = DEFAULT_LANGUAGE) -> Dict:
    """Moved players, the original receiver and the engine's best option, named in `lang`."""
    names = FALLBACK_NAMES[lang]
    modified = [p for p in frame.players if p.is_modified]
    actor = next((p for p in frame.players if p.is_actor), frame.players[0])
    receiver = _receiver(frame, actor)
    optimal = None
    if frame.metrics.optimal_pass_target_id:
        optimal = next((p for p in frame.players if p.player_id == frame.metrics.optimal_pass_target_id), None)

    moved = []
    for p in modified:
        if p.original_x is None or p.original_y is None:
            continue
        dist = math.hypot(p.x - p.original_x, p.y - p.original_y)
        dx, dy = p.x - p.original_x, p.y - p.original_y
        if lang == "es":
            direction = "hacia la banda" if abs(dy) > abs(dx) else ("reculando hacia su portería" if dx < 0 else "adelantando la línea")
            moved.append(f"{p.name} desplazado {dist:.1f} m {direction}")
        else:
            direction = "towards the touchline" if abs(dy) > abs(dx) else ("dropping towards their goal" if dx < 0 else "stepping up")
            moved.append(f"{p.name} moved {dist:.1f} m {direction}")

    return {
        "actor": actor,
        "modified": modified,
        "moved_summary": "; ".join(moved) if moved else ("Sin desplazamiento" if lang == "es" else "No movement"),
        "receiver": receiver,
        "receiver_name": receiver.name if receiver else names["receiver"],
        "receiver_id": receiver.player_id if receiver else actor.player_id,
        "optimal": optimal,
        "optimal_name": optimal.name if optimal else names["optimal"],
        "optimal_id": optimal.player_id if optimal else None,
    }


def counterfactual_debate(frame: MatchFramePayload, lang: Language = DEFAULT_LANGUAGE,
                          audience: Audience = DEFAULT_AUDIENCE,
                          tool_trace: Optional[List[Any]] = None,
                          coach_proposal: Optional[Any] = None) -> List[AgentMessage]:
    """Deterministic debate after a move: names, metric shifts and wording for the chosen profile."""
    m = frame.metrics
    delta = m.xt_delta
    ctx = delta_context(frame, lang)
    mod = ctx["modified"][0] if ctx["modified"] else None
    dist = 0.0
    if mod and mod.original_x is not None and mod.original_y is not None:
        dist = math.hypot(mod.x - mod.original_x, mod.y - mod.original_y)
    optimal = ctx["optimal"]
    optimal_id = ctx["optimal_id"] or ctx["receiver_id"]
    mod_id = mod.player_id if mod else ctx["actor"].player_id

    fields = {
        "mod": mod.name if mod else FALLBACK_NAMES[lang]["defender"],
        "dist": f"{dist:.1f}",
        "mx": f"{mod.x:.1f}" if mod else "-",
        "my": f"{mod.y:.1f}" if mod else "-",
        "mod_spot": describe_spot(mod.x, mod.y, lang) if mod else "",
        "receiver": ctx["receiver_name"],
        "optimal": ctx["optimal_name"],
        "optimal_spot": describe_spot(optimal.x, optimal.y, lang) if optimal else "",
        "orig": f"{m.original_xt:.2f}",
        "sim": f"{m.simulated_xt:.2f}",
        "delta": f"{delta:+.2f}",
        "pct": abs(int((delta / max(0.01, m.original_xt)) * 100)),
        "orig_pct": _pct(m.original_xt),
        "sim_pct": _pct(m.simulated_xt),
        "prob": f"{m.pass_completion_prob:.1f}",
        "ctrl": f"{m.space_control_home_pct:.1f}",
    }
    case = "down" if delta < 0 else "up" if delta > 0 else "flat"
    clock = f"{frame.minute}:{frame.second:02d} [{SIMULATION_TAG[lang]}]"
    templates = TEMPLATES[lang][audience]
    ds_parts = list(templates[DS][case])
    co_parts = list(templates[CO][case])

    if coach_proposal is not None and tool_trace and audience in ("analyst", "coach"):
        opt_xt: Optional[float] = None
        bianchi_xt: Optional[float] = None
        for rec in tool_trace:
            tname = getattr(rec, "tool_name", "")
            res = getattr(rec, "result", {}) or {}
            if tname in ("optimizer/solve", "optimizer_solve"):
                pm = res.get("projected_metrics", {})
                if "simulated_xt" in pm:
                    opt_xt = float(pm["simulated_xt"])
            elif tname == "simulate_counterfactual":
                if "simulated_xt" in res:
                    bianchi_xt = float(res["simulated_xt"])

        p_name = getattr(coach_proposal, "player_name", fields["mod"])
        p_disp = float(getattr(coach_proposal, "displacement_m", 3.5))
        opt_xt_val = opt_xt if opt_xt is not None else m.simulated_xt
        bianchi_xt_val = bianchi_xt if bianchi_xt is not None else m.simulated_xt

        if lang == "es":
            co_parts[1] = (
                f"{co_parts[1]} Propongo bascular a {p_name} {p_disp:.1f} m para tapar ese hueco interior. "
                f"Veredicto táctico: corregir perfil y vigilancia."
            )
            ds_parts[1] = (
                f"{ds_parts[1]} El ajuste de Bianchi deja la jugada en {bianchi_xt_val:.2f} xT frente a "
                f"{opt_xt_val:.2f} xT del óptimo. "
                f"Veredicto cuantitativo: {'ajuste aprobado' if delta <= 0 else 'aplicar solución del optimizador'}."
            )
        else:
            co_parts[1] = (
                f"{co_parts[1]} I propose sliding {p_name} {p_disp:.1f} m to close that inside gap. "
                f"Tactical verdict: adjust cover and body shape."
            )
            ds_parts[1] = (
                f"{ds_parts[1]} Bianchi's shift leaves the play at {bianchi_xt_val:.2f} xT versus "
                f"{opt_xt_val:.2f} xT for the optimum. "
                f"Quantitative verdict: {'adjustment approved' if delta <= 0 else 'apply optimizer solution'}."
            )

    return [
        _message(DS, lang, clock, tuple(ds_parts), fields, [mod_id, ctx["receiver_id"]],
                 f"msg-{str(uuid.uuid4())[:8]}"),
        _message(CO, lang, clock, tuple(co_parts), fields, [mod_id, optimal_id],
                 f"msg-{str(uuid.uuid4())[:8]}"),
    ]


# ---------------------------------------------------------------------------
# LLM prompt (Azure OpenAI)
# ---------------------------------------------------------------------------
AUDIENCE_STYLE = {
    "casual": (
        "Audience: casual fans. Use plain, friendly words and no jargon. Never write 'xT'; describe it as the "
        "chance (in %) that the move leads to a goal. Short sentences, no parentheses."
    ),
    "analyst": (
        "Audience: performance analysts. Quote the key metrics clearly and concisely without parenthetical coordinates."
    ),
    "coach": (
        "Audience: coaching staff. Give a clear verdict on the adjustment and one concrete coaching point."
    ),
    "audio_description": (
        "Audience: blind and low-vision fans listening to audio. Describe where players are on the pitch "
        "and what changes, as spoken commentary. Avoid symbols, coordinates, parentheses and abbreviations."
    ),
}
LANGUAGE_STYLE = {
    "en": "Write every text field in crisp, natural British English football commentary style.",
    "es": "Escribe todos los campos de texto en español de España natural y directo, como un comentarista de fútbol.",
}


def llm_system_prompt(lang: Language, audience: Audience) -> str:
    names = AGENT_NAMES[lang]
    tag = SIMULATION_TAG[lang]
    return (
        "You are the tactical debate engine of 'xT-WhatIf' for professional football (synthetic 360-style frames). "
        "Reply ONLY with a valid JSON object with the key 'debate' holding an array of 2 messages:\n"
        f"1. '{names[DS]}' (agent_role: 'data_scientist', avatar_badge: 'AI-QUANT'): analytical and quantitative; "
        "explains the change in threat with the numbers provided. highlighted_player_ids: the moved defender and "
        "the pass receiver.\n"
        f"2. '{names[CO]}' (agent_role: 'classic_coach', avatar_badge: 'PRO-COACH'): pragmatic dressing-room coach; "
        "challenges or complements the numbers and warns about the alternative receiver. highlighted_player_ids: "
        "the moved defender and the optimal_pass_target_id.\n\n"
        "Rules: use only the numbers given in the user message, never invent statistics; headline is one line; "
        "analysis_body is 1-2 short, natural sentences without parentheses.\n"
        f"{LANGUAGE_STYLE[lang]}\n{AUDIENCE_STYLE[audience]}\n\n"
        "Required JSON structure:\n"
        "{\n"
        "  \"debate\": [\n"
        "    {\"message_id\": \"msg-01\", \"agent_role\": \"data_scientist\", "
        f"\"agent_name\": \"{names[DS]}\", \"avatar_badge\": \"AI-QUANT\", "
        f"\"timestamp_label\": \"MM:SS [{tag}]\", \"headline\": \"...\", \"analysis_body\": \"...\", "
        "\"referenced_metric\": \"...\", \"highlighted_player_ids\": [5, 11]},\n"
        "    {\"message_id\": \"msg-02\", \"agent_role\": \"classic_coach\", "
        f"\"agent_name\": \"{names[CO]}\", \"avatar_badge\": \"PRO-COACH\", "
        f"\"timestamp_label\": \"MM:SS [{tag}]\", \"headline\": \"...\", \"analysis_body\": \"...\", "
        "\"referenced_metric\": \"...\", \"highlighted_player_ids\": [5, 10]}\n"
        "  ]\n"
        "}"
    )


def llm_user_prompt(frame: MatchFramePayload, lang: Language) -> str:
    ctx = delta_context(frame, lang)
    info = frame.match_info
    fixture = (
        f"{info.competition} ({info.home.name} vs {info.away.name}, synthetic data)" if info else "Synthetic match"
    )
    m = frame.metrics
    return (
        f"Match context: {fixture}. Event: {frame.event_type} at {frame.minute}:{frame.second:02d}.\n"
        "Counterfactual telemetry:\n"
        f"- Moved players: {ctx['moved_summary']}\n"
        f"- Original xT: {m.original_xt:.2f} -> Simulated xT: {m.simulated_xt:.2f} (ΔxT: {m.xt_delta:+.2f})\n"
        f"- Current pass completion probability: {m.pass_completion_prob:.1f}%\n"
        f"- Local territorial control (Voronoi, home side): {m.space_control_home_pct:.1f}%\n"
        f"- Optimal receiver detected: {ctx['optimal_name']} (ID {m.optimal_pass_target_id})\n"
        f"- Original pass receiver: {ctx['receiver_name']} (ID {ctx['receiver_id']})\n"
    )


def bianchi_agent_system_prompt(lang: Language, audience: Audience) -> str:
    """System prompt for Coach Bianchi (Classic Coach) in the multi-agent dialectical workflow."""
    name = AGENT_NAMES[lang][CO]
    tag = SIMULATION_TAG[lang]
    return (
        f"You are '{name}' (agent_role: 'classic_coach', avatar_badge: 'PRO-COACH'). "
        "You are a veteran tactical football coach in a dialectical debate with Dr. Voronoi (Data Scientist). "
        "Your job in Turn 1 is to:\n"
        "1. Read the counterfactual freeze-frame and identify the tactical danger.\n"
        "2. Propose a concrete defensive/tactical adjustment within the 6.0m inertia radius (player_id, to_x, to_y) "
        "and state a clear, concise coaching verdict without parentheses.\n"
        "3. Never invent numbers: only cite the exact numbers provided in the telemetry or proposal.\n"
        f"{LANGUAGE_STYLE[lang]}\n{AUDIENCE_STYLE[audience]}\n"
        "Reply ONLY with valid JSON:\n"
        "{\n"
        "  \"proposal\": {\"player_id\": 5, \"to_x\": 92.0, \"to_y\": 38.0, \"reason\": \"...\"},\n"
        "  \"message\": {\n"
        f"    \"message_id\": \"msg-02\", \"agent_role\": \"classic_coach\", \"agent_name\": \"{name}\",\n"
        f"    \"avatar_badge\": \"PRO-COACH\", \"timestamp_label\": \"MM:SS [{tag}]\",\n"
        "    \"headline\": \"...\", \"analysis_body\": \"...\", \"referenced_metric\": \"...\",\n"
        "    \"highlighted_player_ids\": [5, 10]\n"
        "  }\n"
        "}"
    )


def voronoi_agent_system_prompt(lang: Language, audience: Audience) -> str:
    """System prompt for Dr. Voronoi (Data Scientist) in the multi-agent dialectical workflow with tools."""
    name = AGENT_NAMES[lang][DS]
    tag = SIMULATION_TAG[lang]
    return (
        f"You are '{name}' (agent_role: 'data_scientist', avatar_badge: 'AI-QUANT'). "
        "You are the quantitative spatial scientist in a dialectical debate with Coach Bianchi. "
        "You have access to three deterministic engine tools: `simulate_counterfactual`, `optimizer_solve` (optimizer/solve), and `xt_at`.\n"
        "Your job is to:\n"
        "1. Call the engine tools (`xt_at`, `simulate_counterfactual`, `optimizer_solve`) to validate both the user's "
        "counterfactual move and Coach Bianchi's proposed adjustment.\n"
        "2. Contrast with Coach Bianchi using exact metrics in 1-2 short, natural sentences without parentheses.\n"
        "3. Every single number in your text MUST match the exact metrics from the frame or tool outputs.\n"
        f"{LANGUAGE_STYLE[lang]}\n{AUDIENCE_STYLE[audience]}\n"
        "After calling tools, reply ONLY with valid JSON:\n"
        "{\n"
        "  \"verdict\": \"approved | rejected | optimizer_preferred\",\n"
        "  \"message\": {\n"
        f"    \"message_id\": \"msg-01\", \"agent_role\": \"data_scientist\", \"agent_name\": \"{name}\",\n"
        f"    \"avatar_badge\": \"AI-QUANT\", \"timestamp_label\": \"MM:SS [{tag}]\",\n"
        "    \"headline\": \"...\", \"analysis_body\": \"...\", \"referenced_metric\": \"...\",\n"
        "    \"highlighted_player_ids\": [5, 11]\n"
        "  }\n"
        "}"
    )


# ---------------------------------------------------------------------------
# Live game: explanation shown when a key moment is revealed
# ---------------------------------------------------------------------------
REVEAL_TEXT = {
    "en": {
        "headline_attack": "Best move: {who}",
        "headline_defend": "Best defensive move: {who}",
        "moved": "{name} moves {spot}",
        "joiner": " and ",
        "body_attack": "{moves} to open the pass to {target}. The chance of a goal rises from {base}% to {best}%.",
        "body_defend": "{moves} to cover {target}. The chance of a goal falls from {base}% to {best}%.",
        "no_move": "Nobody had to move: the original positions were already the best available.",
        "you_scored": "You reached {score} of 1000 points.",
        "you_beat": "You beat the machine: your move was better than the optimiser's.",
        "you_missed": "You did not submit a move this time.",
        "community": "{share}% of fans got 900 points or more.",
    },
    "es": {
        "headline_attack": "Mejor movimiento: {who}",
        "headline_defend": "Mejor ajuste defensivo: {who}",
        "moved": "{name} va {spot}",
        "joiner": " y ",
        "body_attack": "{moves} para habilitar a {target}. La probabilidad de gol sube del {base}% al {best}%.",
        "body_defend": "{moves} para cerrar sobre {target}. La probabilidad de gol baja del {base}% al {best}%.",
        "no_move": "No hacía falta mover a nadie: las posiciones originales ya eran las mejores.",
        "you_scored": "Has conseguido {score} de 1000 puntos.",
        "you_beat": "Has superado a la máquina: tu movimiento era mejor que el del optimizador.",
        "you_missed": "Esta vez no enviaste ningún movimiento.",
        "community": "El {share}% de los aficionados consiguió 900 puntos o más.",
    },
}


def reveal_explanation(frame: MatchFramePayload, mode: str, moves: List[tuple], base_value: float,
                       best_value: float, best_target_id: Optional[int], lang: Language) -> Dict[str, str]:
    """Headline and body explaining the optimum of a moment (same numbers the engine computed)."""
    text = REVEAL_TEXT[lang]
    by_id = {p.player_id: p for p in frame.players}
    parts, names = [], []
    for pid, x, y in moves:
        p = by_id[pid]
        names.append(p.name)
        parts.append(text["moved"].format(name=p.name, dist=f"{math.hypot(x - p.x, y - p.y):.1f}",
                                          spot=describe_spot(x, y, lang)))
    target = by_id.get(best_target_id)
    if not parts:
        return {"headline": text[f"headline_{mode}"].format(who="—"), "body": text["no_move"]}
    return {
        "headline": text[f"headline_{mode}"].format(who=" + ".join(names)),
        "body": text[f"body_{mode}"].format(
            moves=text["joiner"].join(parts),
            target=target.name if target else FALLBACK_NAMES[lang]["optimal"],
            base=_pct(base_value),
            best=_pct(best_value),
        ),
    }


def _describe_move_list(
    by_id: Dict[int, object],
    moves: List[Tuple[int, float, float]],
    lang: Language,
) -> Tuple[str, str, List[int]]:
    """Returns (who_joined, short_moves_desc, moved_ids) without any parenthetical clutter."""
    if not moves:
        return ("—", "0 m", [])
    names: List[str] = []
    short_parts: List[str] = []
    ids: List[int] = []
    for pid, x, y in moves:
        p = by_id.get(pid)
        if not p:
            continue
        ids.append(pid)
        names.append(p.name)
        dist = math.hypot(x - p.x, y - p.y)
        short_parts.append(f"{p.name} {dist:.0f} m")
    joiner = " y " if lang == "es" else " and "
    return (
        joiner.join(names) if names else "—",
        ", ".join(short_parts) if short_parts else "0 m",
        ids,
    )


def reveal_pundits_and_comparison(
    frame: MatchFramePayload,
    moment_id: str,
    mode: str,
    opt_moves: List[Tuple[int, float, float]],
    base_value: float,
    best_value: float,
    best_target_id: Optional[int],
    user_moves: Optional[List[Tuple[int, float, float]]],
    user_value: Optional[float],
    user_score: Optional[int],
    beat_machine: bool,
    lang: Language,
) -> Dict[str, object]:
    """
    Builds both the visual card explanation AND distinct, natural spoken commentary lines
    (`voronoi_voice`, `bianchi_voice`) for Dr. Voronoi and Coach Bianchi at the Live Match Reveal.
    Spoken lines are short, intuitive broadcast reactions with zero parentheses or coordinates.
    """
    base_exp = reveal_explanation(frame, mode, opt_moves, base_value, best_value, best_target_id, lang)
    by_id = {p.player_id: p for p in frame.players}
    bot_who, _, bot_ids = _describe_move_list(by_id, opt_moves, lang)
    base_pct = _pct(base_value)
    best_pct = _pct(best_value)
    yours_pct = _pct(user_value) if user_value is not None else None
    target = by_id.get(best_target_id)
    target_name = target.name if target else FALLBACK_NAMES[lang]["optimal"]

    opt_coords = {pid: (x, y) for pid, x, y in opt_moves}
    user_who, _, user_ids = (
        _describe_move_list(by_id, user_moves, lang) if user_moves else ("—", "0 m", [])
    )
    same_players = bool(user_moves) and ({pid for pid, _, _ in user_moves} == {pid for pid, _, _ in opt_moves})

    pos_diff_m = 0.0
    if same_players and user_moves:
        diffs = [
            math.hypot(ux - opt_coords[pid][0], uy - opt_coords[pid][1])
            for pid, ux, uy in user_moves
            if pid in opt_coords
        ]
        pos_diff_m = sum(diffs) / len(diffs) if diffs else 0.0

    gap_pct = abs(best_pct - yours_pct) if yours_pct is not None else abs(best_pct - base_pct)

    # 1. Dr. Voronoi: concise card comparison + natural spoken line (different from card text)
    if user_moves is None or yours_pct is None:
        voronoi_comparison = ""
        voronoi_metric = (
            f"Óptimo: {base_pct}% → {best_pct}%" if lang == "es" else f"Optimum: {base_pct}% → {best_pct}%"
        )
        if lang == "es":
            if mode == "attack":
                voronoi_voice = f"La jugada pedía mover a {bot_who} para buscar a {target_name} y subir el peligro de gol al {best_pct} por ciento."
            else:
                voronoi_voice = f"Había que ajustar con {bot_who} sobre {target_name} para bajar el peligro de gol al {best_pct} por ciento."
        else:
            if mode == "attack":
                voronoi_voice = f"The play called for moving {bot_who} to find {target_name} and lift the goal chance to {best_pct} percent."
            else:
                voronoi_voice = f"You needed {bot_who} closing down {target_name} to drop the goal chance to {best_pct} percent."
    elif len(user_moves) == 0:
        if lang == "es":
            voronoi_comparison = (
                f"Sin mover jugadores te quedaste en el {yours_pct}%, mientras que el ajuste con {bot_who} "
                f"llevaba la jugada al {best_pct}%."
            )
            voronoi_voice = (
                f"Al no tocar nada te quedaste en el {yours_pct} por ciento; moviendo a {bot_who} llegábamos al {best_pct} por ciento."
            )
            voronoi_metric = f"Óptimo {best_pct}% vs Tú {yours_pct}%"
        else:
            voronoi_comparison = (
                f"Without moving players you stayed at {yours_pct}%, whereas adjusting {bot_who} "
                f"took the play to {best_pct}%."
            )
            voronoi_voice = (
                f"Keeping everyone still left you at {yours_pct} percent, while moving {bot_who} reached {best_pct} percent."
            )
            voronoi_metric = f"Optimum {best_pct}% vs You {yours_pct}%"
    elif same_players:
        if lang == "es":
            voronoi_comparison = (
                f"Coincidiste con el bot moviendo a {user_who} y dejaste la jugada en el {yours_pct}% "
                f"frente al {best_pct}% óptimo."
            )
            if pos_diff_m <= 2.0 or gap_pct <= 2:
                voronoi_voice = f"Clavaste el ajuste con {user_who}: un {yours_pct} por ciento, prácticamente idéntico al óptimo."
            else:
                voronoi_voice = f"Acertaste moviendo a {user_who} para un {yours_pct} por ciento, a solo un par de metros del {best_pct} por ciento óptimo."
            voronoi_metric = f"Óptimo {best_pct}% vs Tú {yours_pct}%"
        else:
            voronoi_comparison = (
                f"You matched the bot by moving {user_who}, taking the play to {yours_pct}% "
                f"versus the {best_pct}% optimum."
            )
            if pos_diff_m <= 2.0 or gap_pct <= 2:
                voronoi_voice = f"Spot on with {user_who} at {yours_pct} percent, right on the optimal mark."
            else:
                voronoi_voice = f"Good call moving {user_who} for {yours_pct} percent, just a couple of steps shy of the {best_pct} percent best."
            voronoi_metric = f"Optimum {best_pct}% vs You {yours_pct}%"
    else:
        if lang == "es":
            voronoi_comparison = (
                f"Tu ajuste con {user_who} dejó el peligro en el {yours_pct}%, mientras que el bot "
                f"movió a {bot_who} para llegar al {best_pct}%."
            )
            voronoi_voice = (
                f"Tu movimiento con {user_who} dejó un {yours_pct} por ciento, pero la clave estaba en {bot_who} para llegar al {best_pct} por ciento."
            )
            voronoi_metric = f"Bot {best_pct}% vs Tú {yours_pct}%"
        else:
            voronoi_comparison = (
                f"Your move with {user_who} left the threat at {yours_pct}%, whereas the bot "
                f"moved {bot_who} to reach {best_pct}%."
            )
            voronoi_voice = (
                f"Your move with {user_who} gave you {yours_pct} percent, whereas shifting {bot_who} reached {best_pct} percent."
            )
            voronoi_metric = f"Bot {best_pct}% vs You {yours_pct}%"

    # 2. Coach Bianchi: concise card verdict + punchy spoken reaction (different from card text)
    if user_moves is None or user_score is None or yours_pct is None:
        if lang == "es":
            bianchi_headline = "¡En la banda no te puedes quedar helado!"
            personal = (
                f"Esta vez no enviaste ningún movimiento. En directo hay que decidir rápido y ajustar a {bot_who}."
            )
            bianchi_voice = f"Esta vez no enviaste movimiento, míster; en la banda hay que reaccionar rápido con {bot_who}."
            bianchi_metric = f"Sin movimiento | Clave: {bot_who}"
        else:
            bianchi_headline = "Cannot freeze on the touchline!"
            personal = (
                f"You did not submit a move this time. On the touchline you have to act fast and adjust {bot_who}."
            )
            bianchi_voice = f"You did not submit a move this time; on the touchline you have to react fast with {bot_who}."
            bianchi_metric = f"No move sent | Key: {bot_who}"
    elif beat_machine:
        if lang == "es":
            bianchi_headline = f"¡Tu pizarra con {user_who} supera a la máquina!"
            personal = (
                f"Has superado a la máquina con {user_score} de 1000 puntos. El bot movió a {bot_who}, "
                f"pero tu lectura con {user_who} fue todavía mejor."
            )
            bianchi_voice = f"¡Qué barbaridad, míster! Tu jugada con {user_who} supera hasta a la máquina, puro oficio."
            bianchi_metric = f"¡Superaste al bot! {user_score}/1000 pts"
        else:
            bianchi_headline = f"Your board with {user_who} beats the machine!"
            personal = (
                f"You beat the machine with {user_score} of 1000 points. The bot moved {bot_who}, "
                f"but your reading with {user_who} was even better."
            )
            bianchi_voice = f"Brilliant stuff! Your move with {user_who} even beats the machine, pure footballing instinct."
            bianchi_metric = f"Beat the bot! {user_score}/1000 pts"
    elif len(user_moves) == 0:
        if lang == "es":
            bianchi_headline = f"Faltó bascular con {bot_who}"
            personal = (
                f"Has conseguido {user_score} de 1000 puntos. Dejaste al equipo parado cuando la jugada "
                f"pedía ajustar rápido a {bot_who}."
            )
            bianchi_voice = f"Si dejas al equipo clavado nos comen el espacio, míster; había que mover a {bot_who}."
            bianchi_metric = f"Puntuación: {user_score}/1000 | Sin cambios"
        else:
            bianchi_headline = f"Needed to shift {bot_who}"
            personal = (
                f"You reached {user_score} of 1000 points. You left the team standing still when the play "
                f"called for shifting {bot_who}."
            )
            bianchi_voice = f"Leave the team standing still and you get punished; you had to shift {bot_who}."
            bianchi_metric = f"Score: {user_score}/1000 | No moves"
    elif user_score >= 900:
        if same_players:
            if lang == "es":
                bianchi_headline = f"¡Misma lectura que el bot con {user_who}!"
                personal = (
                    f"Has conseguido {user_score} de 1000 puntos. Viste enseguida que la llave de la jugada "
                    f"era mover a {user_who}."
                )
                bianchi_voice = f"¡Lectura de manual, míster! Viste el ajuste de {user_who} en el segundo exacto."
                bianchi_metric = f"Puntuación: {user_score}/1000 | Lectura óptima"
            else:
                bianchi_headline = f"Same reading as the bot with {user_who}!"
                personal = (
                    f"You reached {user_score} of 1000 points. You spotted straight away that moving "
                    f"{user_who} was the key."
                )
                bianchi_voice = f"Textbook reading! You spotted that move with {user_who} right on cue."
                bianchi_metric = f"Score: {user_score}/1000 | Optimal reading"
        else:
            if lang == "es":
                bianchi_headline = f"Tu variante con {user_who} iguala a {bot_who}"
                personal = (
                    f"Has conseguido {user_score} de 1000 puntos. Aunque el bot eligió a {bot_who}, "
                    f"tu alternativa con {user_who} funcionó igual de bien."
                )
                bianchi_voice = f"¡Muy buen ojo! Tu alternativa con {user_who} rinde tan bien como la de la máquina."
                bianchi_metric = f"Puntuación: {user_score}/1000 | Variante eficaz"
            else:
                bianchi_headline = f"Your variant with {user_who} matches {bot_who}"
                personal = (
                    f"You reached {user_score} of 1000 points. Even though the bot picked {bot_who}, "
                    f"your alternative with {user_who} worked just as well."
                )
                bianchi_voice = f"Sharp eye! Your alternative with {user_who} works just as well as the machine's."
                bianchi_metric = f"Score: {user_score}/1000 | Effective variant"
    elif same_players:
        if lang == "es":
            bianchi_headline = f"Buen ojo eligiendo a {user_who}"
            personal = (
                f"Has conseguido {user_score} de 1000 puntos. Acertaste eligiendo a {user_who} como el bot, "
                f"solo faltó ajustar un par de metros más."
            )
            bianchi_voice = f"Elegiste bien a {user_who}, míster, solo faltó dar un par de pasos más para cerrar la jugada."
            bianchi_metric = f"Puntuación: {user_score}/1000 | A {pos_diff_m:.1f} m del óptimo"
        else:
            bianchi_headline = f"Good eye picking {user_who}"
            personal = (
                f"You reached {user_score} of 1000 points. Good eye picking {user_who} like the bot, "
                f"just a couple of steps short of the ideal spot."
            )
            bianchi_voice = f"Right idea picking {user_who}, you just needed two more steps to finish the job."
            bianchi_metric = f"Score: {user_score}/1000 | {pos_diff_m:.1f} m off optimum"
    else:
        if lang == "es":
            bianchi_headline = f"Tu ajuste con {user_who} frente a {bot_who}"
            personal = (
                f"Has conseguido {user_score} de 1000 puntos. Moviste a {user_who}, pero el peligro real "
                f"estaba donde intervino el bot con {bot_who}."
            )
            bianchi_voice = f"Tocaste a {user_who}, pero el peligro de verdad estaba donde cerró la máquina con {bot_who}."
            bianchi_metric = f"Puntuación: {user_score}/1000 | Tú: {user_who} vs Bot: {bot_who}"
        else:
            bianchi_headline = f"Your move with {user_who} vs {bot_who}"
            personal = (
                f"You reached {user_score} of 1000 points. You moved {user_who}, but the real danger "
                f"was where the bot stepped in with {bot_who}."
            )
            bianchi_voice = f"You moved {user_who}, but the real danger was where the machine stepped in with {bot_who}."
            bianchi_metric = f"Score: {user_score}/1000 | You: {user_who} vs Bot: {bot_who}"

    clock = f"{frame.minute:02d}:{frame.second:02d}"
    voronoi_full_body = f"{base_exp['body']} {voronoi_comparison}".strip()
    pundits = [
        AgentMessage(
            message_id=f"{moment_id}-voronoi",
            agent_role=DS,
            agent_name=AGENT_NAMES[lang][DS],
            avatar_badge=BADGES[DS],
            timestamp_label=clock,
            headline=base_exp["headline"],
            analysis_body=voronoi_full_body,
            referenced_metric=voronoi_metric,
            highlighted_player_ids=bot_ids,
        ).model_dump(mode="json"),
        AgentMessage(
            message_id=f"{moment_id}-bianchi",
            agent_role=CO,
            agent_name=AGENT_NAMES[lang][CO],
            avatar_badge=BADGES[CO],
            timestamp_label=clock,
            headline=bianchi_headline,
            analysis_body=personal,
            referenced_metric=bianchi_metric,
            highlighted_player_ids=user_ids if user_ids else bot_ids,
        ).model_dump(mode="json"),
    ]

    return {
        "headline": base_exp["headline"],
        "body": base_exp["body"],
        "voronoi_comparison": voronoi_comparison,
        "bianchi_headline": bianchi_headline,
        "personal": personal,
        "voronoi_voice": voronoi_voice,
        "bianchi_voice": bianchi_voice,
        "pundits": pundits,
    }
