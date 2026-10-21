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
from typing import Dict, List, Literal, Optional

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
                    "Expected threat collapses (-{pct}% relative xT)",
                    "Shifting {mod} {dist} m to ({mx}, {my}) puts the Voronoi cell across the lane to {receiver}. "
                    "xT falls from {orig} to {sim} and pass completion drops to {prob}%.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "up": (
                    "Attacking threat rises sharply ({delta} xT)",
                    "{mod}'s move opens a direct corridor worth {sim} xT. "
                    "Pass completion climbs to {prob}% and local space control grows to {ctrl}%.",
                    "ΔxT: {delta} | Control: {ctrl}%",
                ),
                "flat": (
                    "Statistically neutral: the xT cell is unchanged (ΔxT 0.00)",
                    "Repositioning {mod} keeps the threat vector at {sim} xT. "
                    "Pass completion stays at {prob}% with no meaningful change in territorial control.",
                    "xT: {sim} | Pass prob.: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "You cover the pass to {receiver}, but give away the inside lane",
                    "Yes, {mod} dropping off kills the ball down the outside, but look at the gap opening between "
                    "centre-back and full-back. If the passer looks up and threads it inside to {optimal}, "
                    "we're caught with poor body shape and the holding midfielder out of position.",
                    "Defensive gap open towards {optimal}",
                ),
                "up": (
                    "Aggressive vertical run; watch the cover shift",
                    "Great movement: it drags markers and unsettles the back line. If the ball goes early to "
                    "{optimal} we have numbers in the box, but the holding midfielder must close the far lane "
                    "to stop the counter on a rebound.",
                    "Cover shift required",
                ),
                "flat": (
                    "Good positional hold; not enough pressure on the receiver",
                    "{mod} holds the line but doesn't bother the receiver. If we don't close the pressing distance "
                    "before {optimal} receives facing forward, the block loses the initiative.",
                    "Pressing distance > 2.0 m",
                ),
            },
        },
        "casual": {
            DS: {
                "down": (
                    "That move cuts the danger by {pct}%",
                    "Moving {mod} {dist} metres blocks the route to {receiver}. The attack's chance of leading to "
                    "a goal drops from {orig_pct}% to {sim_pct}%, and the pass now only has a {prob}% chance of arriving.",
                    "Goal threat: {orig_pct}% → {sim_pct}%",
                ),
                "up": (
                    "This makes the attack more dangerous",
                    "With {mod} in the new spot, the attack's chance of leading to a goal rises from {orig_pct}% "
                    "to {sim_pct}%, and the pass is now {prob}% likely to arrive.",
                    "Goal threat: {orig_pct}% → {sim_pct}%",
                ),
                "flat": (
                    "Not much changes",
                    "Moving {mod} keeps the danger about the same: roughly a {sim_pct}% chance of leading to a goal, "
                    "with the pass {prob}% likely to arrive.",
                    "Goal threat: {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Good block, but there's a gap in the middle",
                    "{mod} shuts the obvious pass, but now there's space inside. "
                    "A clever pass to {optimal} would still hurt us.",
                    "Watch out for {optimal}",
                ),
                "up": (
                    "Great run: the defence is pulled apart",
                    "That run drags defenders away. If the ball reaches {optimal} quickly, "
                    "the attack has extra players in the box.",
                    "Key player: {optimal}",
                ),
                "flat": (
                    "Right place, but too passive",
                    "{mod} is in position but isn't close enough to bother anyone. "
                    "{optimal} can still turn and run at the defence.",
                    "Get closer to {optimal}",
                ),
            },
        },
        "coach": {
            DS: {
                "down": (
                    "Validated: threat down {pct}% after the adjustment",
                    "Moving {mod} {dist} m to ({mx}, {my}) lowers xT from {orig} to {sim} (Δ {delta}); the pass to "
                    "{receiver} drops to {prob}% completion. Keep the move inside the 6 m inertia radius so it is "
                    "reachable in real time.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "up": (
                    "Rejected: the adjustment adds {delta} xT",
                    "With {mod} at ({mx}, {my}) xT goes from {orig} to {sim} and pass completion rises to {prob}%. "
                    "The move opens space instead of closing it: revert it or pick another defender.",
                    "ΔxT: {delta} | Pass prob.: {prob}%",
                ),
                "flat": (
                    "No measurable gain (ΔxT 0.00)",
                    "{mod}'s new position leaves xT at {sim} and pass completion at {prob}%. "
                    "Spend the movement on a defender nearer the ball.",
                    "xT: {sim} | Pass prob.: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Coaching point: keep {mod} there and cover inside",
                    "{mod} screens the pass to {receiver}; the nearest central midfielder slides 3 to 4 m inside "
                    "to deny {optimal}. Trigger: the passer's head goes up.",
                    "Cover the lane to {optimal}",
                ),
                "up": (
                    "Coaching point: undo it, the shape breaks",
                    "That position drags the line and frees {optimal}. Hold the line with the centre-back "
                    "and let the full-back press the ball instead.",
                    "Hold the line",
                ),
                "flat": (
                    "Coaching point: press closer",
                    "The position is fine, the intensity isn't. {mod} must close to under 2 m "
                    "before {optimal} receives on the half-turn.",
                    "Pressing distance < 2 m",
                ),
            },
        },
        "audio_description": {
            DS: {
                "down": (
                    "The defence closes the route to {receiver}",
                    "{mod} moves {dist} metres and ends up {mod_spot}. From there, {mod} stands in the path of the "
                    "pass to {receiver}. The attack becomes less dangerous: its chance of leading to a goal falls "
                    "from {orig_pct} to {sim_pct} percent.",
                    "Goal threat {orig_pct}% to {sim_pct}%",
                ),
                "up": (
                    "The attack finds more space",
                    "{mod} moves {dist} metres and ends up {mod_spot}. That opens a path forward: the chance of a goal "
                    "rises from {orig_pct} to {sim_pct} percent, and the pass has a {prob} percent chance of arriving.",
                    "Goal threat {orig_pct}% to {sim_pct}%",
                ),
                "flat": (
                    "The picture stays the same",
                    "{mod} moves {dist} metres and ends up {mod_spot}. Nothing important changes: the chance of a goal "
                    "stays at about {sim_pct} percent.",
                    "Goal threat {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Space opens on the inside",
                    "Picture the gap between the defenders. With {mod} pulled across, {optimal} is free "
                    "{optimal_spot}, waiting for a pass through the middle.",
                    "Free player: {optimal}",
                ),
                "up": (
                    "Defenders are dragged out of position",
                    "The run pulls defenders towards the ball. {optimal} is now unmarked {optimal_spot}; "
                    "a quick pass there would put the attack in front of goal.",
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
                    "Colapso del peligro esperado (-{pct}% en xT relativo)",
                    "Al desplazar a {mod} {dist} metros hacia ({mx}, {my}), su polígono de Voronoi intercepta la "
                    "trayectoria hacia {receiver}. El xT cae de {orig} a {sim} y la probabilidad de pase se reduce "
                    "al {prob}%.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "up": (
                    "Incremento sustancial de amenaza ofensiva ({delta} xT)",
                    "El movimiento de {mod} libera un corredor directo con valor de celda xT de {sim}. "
                    "La probabilidad de pase sube al {prob}% y el dominio espacial local se expande al {ctrl}%.",
                    "ΔxT: {delta} | Control: {ctrl}%",
                ),
                "flat": (
                    "Equilibrio estadístico neutro en la celda xT (ΔxT: 0.00)",
                    "El reposicionamiento de {mod} mantiene el vector de amenaza en {sim} xT. La probabilidad de pase "
                    "se sitúa en {prob}% sin alteración significativa del control territorial.",
                    "xT: {sim} | Prob. pase: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Tapas el pase a {receiver}, pero regalas el carril interior",
                    "Sí, el retroceso de {mod} corta el latigazo por fuera, pero mira cómo se abre el intervalo entre "
                    "central y lateral. Si el pasador levanta la cabeza y filtra por dentro hacia {optimal}, nos "
                    "agarran mal perfilados y con el mediocentro descolgado.",
                    "Intervalo defensivo abierto hacia {optimal}",
                ),
                "up": (
                    "Rompimiento vertical agresivo; ojo a la basculación",
                    "Excelente desmarque que arrastra marcas y descoloca a la última línea. Si el pase va con ventaja "
                    "hacia {optimal}, quedan en superioridad en el área, pero el pivote tiene que cerrar el carril "
                    "opuesto para evitar la contra si hay rebote.",
                    "Basculación defensiva requerida",
                ),
                "flat": (
                    "Fijación posicional correcta; falta agresividad de marca",
                    "{mod} mantiene la línea pero no incomoda la recepción. Si no acortamos la distancia de acoso antes "
                    "de que {optimal} reciba perfilado hacia adelante, el bloque defensivo pierde la iniciativa.",
                    "Distancia de acoso > 2.0 m",
                ),
            },
        },
        "casual": {
            DS: {
                "down": (
                    "Ese movimiento reduce el peligro un {pct}%",
                    "Mover a {mod} {dist} metros tapa el camino hacia {receiver}. La probabilidad de que la jugada "
                    "acabe en gol baja del {orig_pct}% al {sim_pct}%, y el pase solo tiene un {prob}% de llegar.",
                    "Peligro de gol: {orig_pct}% → {sim_pct}%",
                ),
                "up": (
                    "Así el ataque es más peligroso",
                    "Con {mod} en la nueva posición, la probabilidad de que la jugada acabe en gol sube del "
                    "{orig_pct}% al {sim_pct}%, y el pase tiene un {prob}% de llegar.",
                    "Peligro de gol: {orig_pct}% → {sim_pct}%",
                ),
                "flat": (
                    "Apenas cambia nada",
                    "Mover a {mod} deja el peligro casi igual: más o menos un {sim_pct}% de que acabe en gol, "
                    "y el pase tiene un {prob}% de llegar.",
                    "Peligro de gol: {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Buen bloqueo, pero queda un hueco por dentro",
                    "{mod} tapa el pase evidente, pero ahora hay espacio por el centro. "
                    "Un buen pase a {optimal} todavía nos haría daño.",
                    "Cuidado con {optimal}",
                ),
                "up": (
                    "Gran desmarque: la defensa se descoloca",
                    "Ese movimiento arrastra a los defensas. Si el balón llega rápido a {optimal}, "
                    "el ataque tendrá más jugadores en el área.",
                    "Jugador clave: {optimal}",
                ),
                "flat": (
                    "Bien colocado, pero demasiado pasivo",
                    "{mod} está en su sitio pero no molesta a nadie. "
                    "{optimal} todavía puede girarse y encarar a la defensa.",
                    "Acércate a {optimal}",
                ),
            },
        },
        "coach": {
            DS: {
                "down": (
                    "Validado: el peligro baja un {pct}% con el ajuste",
                    "Mover a {mod} {dist} m hasta ({mx}, {my}) baja el xT de {orig} a {sim} (Δ {delta}); el pase a "
                    "{receiver} cae al {prob}% de acierto. Mantén el ajuste dentro del radio de inercia de 6 m para "
                    "que sea alcanzable en tiempo real.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "up": (
                    "Descartado: el ajuste suma {delta} xT",
                    "Con {mod} en ({mx}, {my}) el xT pasa de {orig} a {sim} y la probabilidad de pase sube al {prob}%. "
                    "El movimiento abre espacio en vez de cerrarlo: deshazlo o elige otro defensor.",
                    "ΔxT: {delta} | Prob. pase: {prob}%",
                ),
                "flat": (
                    "Sin ganancia medible (ΔxT 0.00)",
                    "La nueva posición de {mod} deja el xT en {sim} y la probabilidad de pase en {prob}%. "
                    "Invierte el movimiento en un defensor más cercano al balón.",
                    "xT: {sim} | Prob. pase: {prob}%",
                ),
            },
            CO: {
                "down": (
                    "Consigna: {mod} se queda ahí y cerramos por dentro",
                    "{mod} tapa el pase a {receiver}; el mediocentro más cercano bascula 3 o 4 m hacia dentro para "
                    "negar a {optimal}. Señal: cuando el pasador levanta la cabeza.",
                    "Cerrar la línea hacia {optimal}",
                ),
                "up": (
                    "Consigna: deshazlo, se rompe la estructura",
                    "Esa posición arrastra la línea y libera a {optimal}. Que el central mantenga la línea "
                    "y sea el lateral quien salga a presionar el balón.",
                    "Mantener la línea",
                ),
                "flat": (
                    "Consigna: presión más cerca",
                    "La posición es buena, la intensidad no. {mod} tiene que cerrar a menos de 2 m "
                    "antes de que {optimal} reciba a media vuelta.",
                    "Distancia de presión < 2 m",
                ),
            },
        },
        "audio_description": {
            DS: {
                "down": (
                    "La defensa cierra el camino hacia {receiver}",
                    "{mod} se desplaza {dist} metros y queda {mod_spot}. Desde ahí se coloca en la trayectoria del "
                    "pase hacia {receiver}. El ataque pierde peligro: la probabilidad de gol baja del {orig_pct} "
                    "al {sim_pct} por ciento.",
                    "Peligro de gol {orig_pct}% a {sim_pct}%",
                ),
                "up": (
                    "El ataque encuentra más espacio",
                    "{mod} se desplaza {dist} metros y queda {mod_spot}. Eso abre un camino hacia delante: la "
                    "probabilidad de gol sube del {orig_pct} al {sim_pct} por ciento, y el pase tiene un {prob} "
                    "por ciento de llegar.",
                    "Peligro de gol {orig_pct}% a {sim_pct}%",
                ),
                "flat": (
                    "La situación no cambia",
                    "{mod} se desplaza {dist} metros y queda {mod_spot}. No cambia nada importante: la probabilidad de gol "
                    "sigue en torno al {sim_pct} por ciento.",
                    "Peligro de gol {sim_pct}%",
                ),
            },
            CO: {
                "down": (
                    "Se abre espacio por dentro",
                    "Imagina el hueco entre los defensas. Con {mod} desplazado, {optimal} queda libre "
                    "{optimal_spot}, esperando un pase por el centro.",
                    "Jugador libre: {optimal}",
                ),
                "up": (
                    "Los defensas quedan fuera de sitio",
                    "El desmarque arrastra a los defensas hacia el balón. {optimal} queda sin marca {optimal_spot}; "
                    "un pase rápido ahí dejaría al ataque frente a la portería.",
                    "Jugador libre: {optimal}",
                ),
                "flat": (
                    "El defensor aguanta la posición pero no aprieta",
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
            moved.append(f"{p.name} (#{p.jersey_number}) desplazado {dist:.1f} m {direction} a ({p.x:.1f}, {p.y:.1f})")
        else:
            direction = "towards the touchline" if abs(dy) > abs(dx) else ("dropping towards their goal" if dx < 0 else "stepping up")
            moved.append(f"{p.name} (#{p.jersey_number}) moved {dist:.1f} m {direction} to ({p.x:.1f}, {p.y:.1f})")

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
                          audience: Audience = DEFAULT_AUDIENCE) -> List[AgentMessage]:
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
    return [
        _message(DS, lang, clock, templates[DS][case], fields, [mod_id, ctx["receiver_id"]],
                 f"msg-{str(uuid.uuid4())[:8]}"),
        _message(CO, lang, clock, templates[CO][case], fields, [mod_id, optimal_id],
                 f"msg-{str(uuid.uuid4())[:8]}"),
    ]


# ---------------------------------------------------------------------------
# LLM prompt (Azure OpenAI)
# ---------------------------------------------------------------------------
AUDIENCE_STYLE = {
    "casual": (
        "Audience: casual fans. Use plain, friendly words and no jargon. Never write 'xT'; describe it as the "
        "chance (in %) that the move leads to a goal. Short sentences."
    ),
    "analyst": (
        "Audience: performance analysts. Quote the exact metrics: xT on the 16x12 grid, pass probability and "
        "Voronoi space control. Precise, technical tone."
    ),
    "coach": (
        "Audience: coaching staff. Give a clear verdict on the adjustment (keep it or undo it) and one concrete, "
        "actionable coaching point. Use tactical vocabulary."
    ),
    "audio_description": (
        "Audience: blind and low-vision fans listening to audio. Describe where players are on the pitch "
        "(wing, half-space, middle, distance from goal) and what changes, as spoken commentary. Say numbers "
        "in words-friendly form ('18 percent'), avoid symbols, coordinates and abbreviations."
    ),
}
LANGUAGE_STYLE = {
    "en": "Write every text field in British English football commentary style.",
    "es": "Escribe todos los campos de texto en español de España, con el estilo de un comentarista de fútbol.",
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
        "analysis_body is 2-3 sentences.\n"
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
