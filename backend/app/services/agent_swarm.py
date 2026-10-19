"""
Dialectical Multi-Agent Tactical Swarm for xT-WhatIf.
Orchestrates high-level debates between:
- Dr. Voronoi (Data Scientist) [AI-QUANT]: Rigorous spatial metrics, xT grid shifts, Voronoi territory.
- Míster Bianchi (Classic Coach) [PRO-COACH]: Tactical football wisdom, rest defense, marking profiles, passing lane risks.

Features:
1. In-memory simulation cache (_simulation_cache) for sub-10ms repeat responses.
2. Async Azure OpenAI client with structured JSON parsing and 3.5s timeout.
3. Dynamic heuristic fallback that interpolates real player names, meters displaced, and optimal targets.
"""

import math
import uuid
import json
import asyncio
import logging
from typing import List, Dict, Tuple, Optional, Any
from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.schemas.match_contract import (
    MatchFramePayload, AgentMessage, AgentRole, PlayerNode
)

logger = logging.getLogger(__name__)

# In-memory LRU-style cache for simulation debates
# Key: (event_uuid, tuple_of_sorted_modified_positions) -> List[AgentMessage]
_simulation_cache: Dict[Tuple[str, Tuple], List[AgentMessage]] = {}


class TacticalAgentSwarm:
    def __init__(self):
        self.client: Optional[AsyncAzureOpenAI] = None
        self._init_azure_client()

    def _init_azure_client(self):
        if (
            settings.AZURE_OPENAI_API_KEY
            and settings.AZURE_OPENAI_API_KEY not in ("mock-key", "", "your-azure-openai-key-here")
            and settings.AZURE_OPENAI_ENDPOINT
            and "mock.openai.azure.com" not in settings.AZURE_OPENAI_ENDPOINT
        ):
            try:
                self.client = AsyncAzureOpenAI(
                    api_key=settings.AZURE_OPENAI_API_KEY,
                    api_version=settings.AZURE_OPENAI_API_VERSION,
                    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT
                )
                logger.info("TacticalAgentSwarm: Azure OpenAI client initialized successfully.")
            except Exception as e:
                logger.warning(f"Could not initialize Azure OpenAI client: {e}. Running in heuristic fallback mode.")
                self.client = None
        else:
            self.client = None

    def _build_cache_key(self, frame: MatchFramePayload) -> Tuple[str, Tuple]:
        """Creates a deterministic cache key from modified player coordinates."""
        mod_tuples = tuple(
            sorted(
                (p.player_id, round(p.x, 1), round(p.y, 1))
                for p in frame.players
                if p.is_modified
            )
        )
        return (frame.event_uuid, mod_tuples)

    async def generate_debate(self, frame: MatchFramePayload) -> List[AgentMessage]:
        """
        Generates multi-agent debate based on the simulated frame.
        Checks cache first (<10ms), tries Azure OpenAI with 3.5s timeout, and falls back to dynamic heuristics.
        """
        cache_key = self._build_cache_key(frame)
        if cache_key in _simulation_cache:
            logger.info("Serving agent debate from in-memory simulation cache.")
            return _simulation_cache[cache_key]

        messages: Optional[List[AgentMessage]] = None

        # Attempt Azure OpenAI call if configured
        if self.client:
            try:
                messages = await asyncio.wait_for(
                    self._run_azure_openai_debate(frame),
                    timeout=3.5
                )
            except asyncio.TimeoutError:
                logger.warning("Azure OpenAI debate call timed out (>3.5s). Falling back to dynamic heuristics.")
            except Exception as e:
                logger.warning(f"Azure OpenAI debate call failed: {e}. Falling back to dynamic heuristics.")

        # Fallback to dynamic, resilient heuristic generator
        if not messages:
            messages = self._generate_dynamic_heuristic_debate(frame)

        # Cache result
        _simulation_cache[cache_key] = messages
        return messages

    async def _run_azure_openai_debate(self, frame: MatchFramePayload) -> Optional[List[AgentMessage]]:
        """Executes a structured JSON call to Azure OpenAI generating both agent perspectives."""
        if not self.client:
            return None

        # Prepare Delta Context
        delta_ctx = self._extract_delta_context(frame)

        system_prompt = (
            "Eres el motor de debate táctico de 'xT-WhatIf' para fútbol profesional (StatsBomb 360). "
            "Debes responder ÚNICAMENTE con un objeto JSON válido que contenga la clave 'debate' con un array de 2 mensajes: "
            "1. 'Dr. Voronoi' (agent_role: 'data_scientist', avatar_badge: 'AI-QUANT'): Analítico y estadístico, cita el impacto del Expected Threat (xT) sobre la matriz 16x12, el porcentaje de dominio de Voronoi y la probabilidad de pase. En highlighted_player_ids incluye el defensor movido y el receptor del pase.\n"
            "2. 'Míster Bianchi' (agent_role: 'classic_coach', avatar_badge: 'PRO-COACH'): Entrenador pragmático y de vestuario, usa jerga futbolística ('basculación', 'intervalo central-lateral', 'perfil de orientación', 'espalda del pivote'). Rebate o complementa las métricas advirtiendo de la nueva amenaza del receptor alternativo. En highlighted_player_ids incluye el defensor movido y el optimal_pass_target_id.\n\n"
            "Estructura JSON requerida:\n"
            "{\n"
            "  \"debate\": [\n"
            "    {\n"
            "      \"message_id\": \"msg-01\",\n"
            "      \"agent_role\": \"data_scientist\",\n"
            "      \"agent_name\": \"Dr. Voronoi (Data Scientist)\",\n"
            "      \"avatar_badge\": \"AI-QUANT\",\n"
            "      \"timestamp_label\": \"MM:SS [SIMULACIÓN]\",\n"
            "      \"headline\": \"Titular de 1 línea impactante\",\n"
            "      \"analysis_body\": \"Explicación cuantitativa de 2-3 frases\",\n"
            "      \"referenced_metric\": \"Dato clave (ej: ΔxT: -0.28 | Prob: 31.2%)\",\n"
            "      \"highlighted_player_ids\": [5, 11]\n"
            "    },\n"
            "    {\n"
            "      \"message_id\": \"msg-02\",\n"
            "      \"agent_role\": \"classic_coach\",\n"
            "      \"agent_name\": \"Míster Bianchi (Entrenador Clásico)\",\n"
            "      \"avatar_badge\": \"PRO-COACH\",\n"
            "      \"timestamp_label\": \"MM:SS [SIMULACIÓN]\",\n"
            "      \"headline\": \"Titular táctico de 1 línea\",\n"
            "      \"analysis_body\": \"Explicación de vestuario de 2-3 frases\",\n"
            "      \"referenced_metric\": \"Concepto táctico clave citado\",\n"
            "      \"highlighted_player_ids\": [5, 10]\n"
            "    }\n"
            "  ]\n"
            "}"
        )

        user_prompt = (
            f"Contexto del Partido: Final Copa del Mundo 2022 (Argentina vs Francia). Evento: {frame.event_type} en {frame.minute}:{frame.second:02d}.\n"
            f"Telemetría Contrafactual:\n"
            f"- Jugadores modificados: {delta_ctx['moved_summary']}\n"
            f"- xT Real: {frame.metrics.original_xt:.2f} -> xT Simulado: {frame.metrics.simulated_xt:.2f} (ΔxT: {frame.metrics.xt_delta:+.2f})\n"
            f"- Probabilidad de éxito de pase actual: {frame.metrics.pass_completion_prob:.1f}%\n"
            f"- Dominio territorial local (Voronoi): {frame.metrics.space_control_home_pct:.1f}%\n"
            f"- Receptor óptimo detectado: {delta_ctx['optimal_target_name']} (ID {frame.metrics.optimal_pass_target_id})\n"
            f"- Receptor del pase original: {delta_ctx['receiver_name']} (ID {delta_ctx['receiver_id']})\n"
        )

        response = await self.client.chat.completions.create(
            model=settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=600
        )

        content = response.choices[0].message.content
        if not content:
            return None

        parsed = json.loads(content)
        debate_list = parsed.get("debate", [])
        if len(debate_list) >= 2:
            return [AgentMessage(**item) for item in debate_list]

        return None

    def _extract_delta_context(self, frame: MatchFramePayload) -> Dict[str, Any]:
        """Calculates structured delta variables: displacements, directions, and involved actors."""
        modified_players = [p for p in frame.players if p.is_modified]
        actor = next((p for p in frame.players if p.is_actor), frame.players[0])

        # Find receiver of the primary pass
        receiver: Optional[PlayerNode] = None
        if frame.ball_end_x is not None and frame.ball_end_y is not None:
            non_actors = [p for p in frame.players if not p.is_actor and p.team == frame.possession_team]
            if non_actors:
                receiver = min(
                    non_actors,
                    key=lambda p: math.hypot(p.x - frame.ball_end_x, p.y - frame.ball_end_y)
                )

        # Find optimal pass target player
        optimal_target: Optional[PlayerNode] = None
        if frame.metrics.optimal_pass_target_id:
            optimal_target = next(
                (p for p in frame.players if p.player_id == frame.metrics.optimal_pass_target_id),
                None
            )

        moved_descriptions = []
        for p in modified_players:
            if p.original_x is not None and p.original_y is not None:
                dist = math.hypot(p.x - p.original_x, p.y - p.original_y)
                dx = p.x - p.original_x
                dy = p.y - p.original_y
                direction = "hacia la banda" if abs(dy) > abs(dx) else ("reculando hacia su arco" if dx < 0 else "adelantando la línea")
                moved_descriptions.append(f"{p.name} (#{p.jersey_number}) desplazado {dist:.1f}m {direction} a ({p.x:.1f}, {p.y:.1f})")

        return {
            "actor_name": actor.name,
            "actor_id": actor.player_id,
            "modified_players": modified_players,
            "moved_summary": "; ".join(moved_descriptions) if moved_descriptions else "Sin desplazamiento",
            "receiver_name": receiver.name if receiver else "Receptor en banda",
            "receiver_id": receiver.player_id if receiver else actor.player_id,
            "optimal_target_name": optimal_target.name if optimal_target else "Receptor alternativo",
            "optimal_target_id": optimal_target.player_id if optimal_target else None,
        }

    def _generate_dynamic_heuristic_debate(self, frame: MatchFramePayload) -> List[AgentMessage]:
        """
        Deterministic, fully dynamic debate generator.
        Interpolates exact player names, metric shifts, and tactical terminology.
        Guarantees zero downtime and instant response.
        """
        metrics = frame.metrics
        delta = metrics.xt_delta
        ctx = self._extract_delta_context(frame)

        mod_p = ctx["modified_players"][0] if ctx["modified_players"] else None
        mod_name = mod_p.name if mod_p else "el defensor"
        mod_id = mod_p.player_id if mod_p else ctx["actor_id"]

        receiver_name = ctx["receiver_name"]
        receiver_id = ctx["receiver_id"]
        optimal_name = ctx["optimal_target_name"]
        optimal_id = ctx["optimal_target_id"] or receiver_id

        dist_m = 0.0
        if mod_p and mod_p.original_x is not None and mod_p.original_y is not None:
            dist_m = math.hypot(mod_p.x - mod_p.original_x, mod_p.y - mod_p.original_y)

        # ---------------------------------------------------------------------
        # 1. Dr. Voronoi (Data Scientist) [AI-QUANT]
        # ---------------------------------------------------------------------
        if delta < 0:
            pct_decay = abs(int((delta / max(0.01, metrics.original_xt)) * 100))
            ds_headline = f"Colapso del peligro esperado (-{pct_decay}% en xT relativo)"
            ds_body = (
                f"Al desplazar a {mod_name} {dist_m:.1f} metros hacia ({mod_p.x:.1f}, {mod_p.y:.1f}), su polígono de Voronoi "
                f"intercepta la trayectoria hacia {receiver_name}. El xT cae de {metrics.original_xt:.2f} a {metrics.simulated_xt:.2f} "
                f"y la probabilidad de pase se reduce drásticamente al {metrics.pass_completion_prob:.1f}%."
            )
            ds_ref = f"ΔxT: {delta:+.2f} | Prob. Pase: {metrics.pass_completion_prob:.1f}%"
        elif delta > 0:
            ds_headline = f"Incremento sustancial de amenaza ofensiva (+{delta:.2f} xT)"
            ds_body = (
                f"El movimiento de {mod_name} libera un corredor directo con valor de celda xT de {metrics.simulated_xt:.2f}. "
                f"La probabilidad de pase sube al {metrics.pass_completion_prob:.1f}% y el dominio espacial local se expande al {metrics.space_control_home_pct:.1f}%."
            )
            ds_ref = f"ΔxT: +{delta:.2f} | Control: {metrics.space_control_home_pct:.1f}%"
        else:
            ds_headline = "Equilibrio estadístico neutro en la celda xT (ΔxT: 0.00)"
            ds_body = (
                f"El reposicionamiento de {mod_name} mantiene el vector de amenaza en {metrics.simulated_xt:.2f} xT. "
                f"La probabilidad de pase se sitúa en {metrics.pass_completion_prob:.1f}% sin alteración significativa del control territorial."
            )
            ds_ref = f"xT: {metrics.simulated_xt:.2f} | Prob: {metrics.pass_completion_prob:.1f}%"

        msg_ds = AgentMessage(
            message_id=f"msg-{str(uuid.uuid4())[:8]}",
            agent_role=AgentRole.DATA_SCIENTIST,
            agent_name="Dr. Voronoi (Data Scientist)",
            avatar_badge="AI-QUANT",
            timestamp_label=f"{frame.minute}:{frame.second:02d} [SIMULACIÓN]",
            headline=ds_headline,
            analysis_body=ds_body,
            referenced_metric=ds_ref,
            highlighted_player_ids=[mod_id, receiver_id],
        )

        # ---------------------------------------------------------------------
        # 2. Míster Bianchi (Classic Coach) [PRO-COACH]
        # ---------------------------------------------------------------------
        if delta < 0:
            coach_headline = f"Tapas el pase a {receiver_name}, pero regalas el carril interior"
            coach_body = (
                f"Sí, el retroceso de {mod_name} corta el latigazo por fuera, pero mira cómo se abre el intervalo entre central y lateral. "
                f"Si el pasador levanta la cabeza y filtra por dentro hacia {optimal_name}, nos agarran mal perfilados y con el mediocentro descolgado."
            )
            coach_ref = f"Intervalo Defensivo Abierto hacia {optimal_name}"
        elif delta > 0:
            coach_headline = "Rompimiento vertical agresivo; ojo a la basculación"
            coach_body = (
                f"Excelente desmarque que arrastra marcas y descoloca a la última línea. Si el pase va con ventaja hacia {optimal_name}, "
                f"quedan en ventaja numérica en el área, pero el pivote tiene que cerrar el carril opuesto para evitar la contra si hay rebote."
            )
            coach_ref = "Basculación Defensiva Requerida"
        else:
            coach_headline = f"Fijación posicional correcta; falta agresividad de marca"
            coach_body = (
                f"{mod_name} mantiene la línea pero no incomoda la recepción. Si no acortamos la distancia de acoso antes de que "
                f"{optimal_name} reciba perfilado hacia adelante, el bloque defensivo pierde la iniciativa."
            )
            coach_ref = "Distancia de Acoso > 2.0m"

        msg_coach = AgentMessage(
            message_id=f"msg-{str(uuid.uuid4())[:8]}",
            agent_role=AgentRole.CLASSIC_COACH,
            agent_name="Míster Bianchi (Entrenador Clásico)",
            avatar_badge="PRO-COACH",
            timestamp_label=f"{frame.minute}:{frame.second:02d} [SIMULACIÓN]",
            headline=coach_headline,
            analysis_body=coach_body,
            referenced_metric=coach_ref,
            highlighted_player_ids=[mod_id, optimal_id],
        )

        return [msg_ds, msg_coach]


swarm = TacticalAgentSwarm()
