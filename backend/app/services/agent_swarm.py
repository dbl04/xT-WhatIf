"""
Multi-Agent Tactical Swarm Orchestrator for xT-WhatIf.
Orchestrates the debate between:
- Dr. Voronoi (Data Scientist) [AI-QUANT]
- Míster Bianchi (Entrenador Clásico) [PRO-COACH]
"""

import uuid
import logging
from typing import List, Optional
from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.schemas.match_contract import (
    MatchFramePayload, AgentMessage, AgentRole
)

logger = logging.getLogger(__name__)


class TacticalAgentSwarm:
    def __init__(self):
        self.client: Optional[AsyncAzureOpenAI] = None
        if settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_API_KEY != "mock-key":
            try:
                self.client = AsyncAzureOpenAI(
                    api_key=settings.AZURE_OPENAI_API_KEY,
                    api_version=settings.AZURE_OPENAI_API_VERSION,
                    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT
                )
            except Exception as e:
                logger.warning(f"Azure OpenAI client setup failed: {e}. Running in local heuristic mode.")

    async def generate_debate(self, frame: MatchFramePayload) -> List[AgentMessage]:
        """Generates multi-agent debate based on the simulated frame."""
        # Check if Azure OpenAI client is available
        if self.client:
            try:
                return await self._run_llm_debate(frame)
            except Exception as e:
                logger.warning(f"Swarm LLM call failed: {e}. Falling back to domain heuristics.")

        return self._generate_heuristic_debate(frame)

    def _generate_heuristic_debate(self, frame: MatchFramePayload) -> List[AgentMessage]:
        metrics = frame.metrics
        delta = metrics.xt_delta
        actor = next((p for p in frame.players if p.is_actor), frame.players[0])
        modified = [p for p in frame.players if p.is_modified]
        mod_names = ", ".join(p.name for p in modified) if modified else "los jugadores"

        # Highlight actor and modified player IDs
        highlight_ids = [actor.player_id] + [p.player_id for p in modified]
        if metrics.optimal_pass_target_id:
            highlight_ids.append(metrics.optimal_pass_target_id)
        highlight_ids = list(set(highlight_ids))

        # 1. Dr. Voronoi (Data Scientist)
        if delta < 0:
            ds_headline = f"Colapso del peligro esperado ({delta:+.2f} en xT relativo)"
            ds_body = (
                f"Al desplazar a {mod_names}, el modelo Voronoi reduce el espacio de recepción efectivo. "
                f"El xT cae de {metrics.original_xt:.2f} a {metrics.simulated_xt:.2f} con una probabilidad de pase del {metrics.pass_completion_prob:.1f}%."
            )
            ds_ref = f"ΔxT: {delta:+.2f} | Prob. Pase: {metrics.pass_completion_prob:.1f}%"
        elif delta > 0:
            ds_headline = f"Incremento de amenaza ofensiva (+{delta:.2f} xT)"
            ds_body = (
                f"El nuevo posicionamiento de {mod_names} amplía el control territorial home al {metrics.space_control_home_pct:.1f}%. "
                f"Se genera una ganancia neta de +{delta:.2f} xT sobre el tercio final."
            )
            ds_ref = f"ΔxT: +{delta:.2f} | Dominio: {metrics.space_control_home_pct:.1f}%"
        else:
            ds_headline = "Equilibrio estadístico neutro (ΔxT: 0.00)"
            ds_body = (
                f"El movimiento mantiene constante el valor de amenaza esperada ({metrics.simulated_xt:.2f} xT). "
                f"La probabilidad de pase se sitúa en {metrics.pass_completion_prob:.1f}%."
            )
            ds_ref = f"xT: {metrics.simulated_xt:.2f} | Control: {metrics.space_control_home_pct:.1f}%"

        msg_ds = AgentMessage(
            message_id=f"msg-{str(uuid.uuid4())[:6]}",
            agent_role=AgentRole.DATA_SCIENTIST,
            agent_name="Dr. Voronoi (Data Scientist)",
            avatar_badge="AI-QUANT",
            timestamp_label=f"{frame.minute}:{frame.second:02d} [SIMULACIÓN]",
            headline=ds_headline,
            analysis_body=ds_body,
            referenced_metric=ds_ref,
            highlighted_player_ids=highlight_ids,
        )

        # 2. Míster Bianchi (Entrenador Clásico)
        if delta < 0:
            coach_headline = "Perfilación correcta, pero regalas el carril interior"
            coach_body = (
                f"Sí, tapas el latigazo por banda, pero mira el hueco que dejas entre líneas. "
                f"Si {actor.name} amaga y filtra por dentro, nos parten la estructura defensiva al medio."
            )
            coach_ref = "Intervalo Central-Lateral vulnerable"
        elif delta > 0:
            coach_headline = "Movimiento vertical agresivo; ojo a la basculación"
            coach_body = (
                f"Excelente desmarque para estirar a los centrales. Si metemos el pase con ventaja a la carrera, "
                f"quedan descolgados, pero el pivote tiene que cerrar el carril opuesto ya mismo."
            )
            coach_ref = "Basculación Defensiva Requerida"
        else:
            coach_headline = "Fijación posicional sin ruptura"
            coach_body = (
                f"El movimiento no rompe líneas todavía. Sirve para atraer la marca, "
                f"pero necesitamos un tercer hombre que rompa al espacio libre."
            )
            coach_ref = "Falta de Tercer Hombre"

        msg_coach = AgentMessage(
            message_id=f"msg-{str(uuid.uuid4())[:6]}",
            agent_role=AgentRole.CLASSIC_COACH,
            agent_name="Míster Bianchi (Entrenador Clásico)",
            avatar_badge="PRO-COACH",
            timestamp_label=f"{frame.minute}:{frame.second:02d} [SIMULACIÓN]",
            headline=coach_headline,
            analysis_body=coach_body,
            referenced_metric=coach_ref,
            highlighted_player_ids=highlight_ids,
        )

        return [msg_ds, msg_coach]

    async def _run_llm_debate(self, frame: MatchFramePayload) -> List[AgentMessage]:
        return self._generate_heuristic_debate(frame)


swarm = TacticalAgentSwarm()
