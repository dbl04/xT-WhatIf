"""
Dialectical Multi-Agent Tactical Swarm for xT-WhatIf.

Orchestrates real tool-calling multi-agent debates between:
- Coach Bianchi (Classic Coach) [PRO-COACH]: Proposes a concrete tactical adjustment within the
  6.0m biomechanical inertia ring to close exposed intervals and passing lanes.
- Dr. Voronoi (Data Scientist) [AI-QUANT]: Validates both the user's move and Bianchi's proposal
  by calling the deterministic engine tools (`simulate_counterfactual`, `optimizer/solve`, `xt_at`),
  disagrees/contrasts with exact metrics, and issues a quantitative verdict.

Features:
1. Multi-Agent Tool-Calling Orchestrator (`app.agents.orchestrator.DialecticalAgentOrchestrator`)
   supporting Microsoft Agent Framework, Azure AI Foundry Agent Service, and Azure OpenAI Tools.
2. Deterministic Numerical Verifier (`app.agents.verifier.verify_and_repair_debate`): every number
   in the LLM output must match ground-truth metrics; mismatches are repaired or fall back to template.
3. In-memory simulation cache (`_simulation_cache`) for sub-10ms repeat responses.
4. Personalisation: language (`en` / `es`) x audience (`casual`, `analyst`, `coach`, `audio_description`).
5. Natural-language What-If support (`"¿y si el lateral cierra por dentro?"`) using the same tools.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Tuple
from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.schemas.match_contract import AgentMessage, MatchFramePayload
from app.services.narration import (
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    Audience,
    Language,
    counterfactual_debate,
    normalize_audience,
    normalize_language,
)
from app.agents.orchestrator import DialecticalAgentOrchestrator, DialecticalDebateReport
from app.agents.tools import EngineToolRegistry, propose_coach_adjustment
from app.agents.verifier import verify_and_repair_debate
from app.agents.what_if_nl import (
    WhatIfNLRequest,
    WhatIfNLResponse,
    execute_natural_language_what_if,
)

logger = logging.getLogger(__name__)

# In-memory LRU-style cache for simulation debates
# Key: (event_uuid, tuple_of_sorted_modified_positions, language, audience) -> List[AgentMessage]
_simulation_cache: Dict[Tuple, List[AgentMessage]] = {}
_simulation_report_cache: Dict[Tuple, DialecticalDebateReport] = {}


class TacticalAgentSwarm:
    def __init__(self):
        self.client: Optional[AsyncAzureOpenAI] = None
        self._init_azure_client()
        self.orchestrator = DialecticalAgentOrchestrator(client=self.client)
        self.last_report: Optional[DialecticalDebateReport] = None

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
                    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                )
                logger.info("TacticalAgentSwarm: Azure OpenAI / Foundry client initialized successfully.")
            except Exception as e:
                logger.warning(f"Could not initialize Azure OpenAI client: {e}. Running in deterministic tool mode.")
                self.client = None
        else:
            self.client = None

    def _build_cache_key(
        self,
        frame: MatchFramePayload,
        language: Language = DEFAULT_LANGUAGE,
        audience: Audience = DEFAULT_AUDIENCE,
    ) -> Tuple:
        """Creates a deterministic cache key from modified player coordinates and the narration profile."""
        mod_tuples = tuple(
            sorted(
                (p.player_id, round(p.x, 1), round(p.y, 1))
                for p in frame.players
                if p.is_modified
            )
        )
        return (frame.event_uuid, mod_tuples, language, audience)

    async def generate_debate(
        self,
        frame: MatchFramePayload,
        language: Language = DEFAULT_LANGUAGE,
        audience: Audience = DEFAULT_AUDIENCE,
    ) -> List[AgentMessage]:
        """
        Generates a verified multi-agent debate on the simulated frame:
        - Checks `_simulation_cache` first (<10ms).
        - Runs the Dialectical Multi-Agent Orchestrator (Bianchi proposes adjustment ->
          Voronoi validates with `simulate_counterfactual`, `optimizer/solve`, `xt_at` ->
          Deterministic Verifier checks every number).
        - Preserves the exact `List[AgentMessage]` response contract.
        """
        lang = normalize_language(language)
        aud = normalize_audience(audience)
        cache_key = self._build_cache_key(frame, lang, aud)
        if cache_key in _simulation_cache:
            logger.info("Serving agent debate from in-memory simulation cache.")
            if cache_key in _simulation_report_cache:
                self.last_report = _simulation_report_cache[cache_key]
            return _simulation_cache[cache_key]

        timeout_s = getattr(settings, "AGENT_SWARM_TIMEOUT_S", 8.0) or 8.0
        report: Optional[DialecticalDebateReport] = None

        try:
            self.orchestrator.client = self.client
            report = await asyncio.wait_for(
                self.orchestrator.run_debate(frame, language=lang, audience=aud, client=self.client),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Multi-agent debate timed out (>%.1fs). Falling back to deterministic verified template.",
                timeout_s,
            )
        except Exception as e:
            logger.warning("Multi-agent debate call failed (%s). Falling back to deterministic verified template.", e)

        if report is None:
            # Even on timeout/error, run the deterministic tool validation & verifier
            registry = EngineToolRegistry(bound_frame=frame)
            proposal = propose_coach_adjustment(frame, lang)
            await self.orchestrator._ensure_validation_tools_called(registry, frame, proposal, lang)
            fallback_msgs = counterfactual_debate(
                frame, lang, aud, tool_trace=registry.trace, coach_proposal=proposal
            )
            verification = verify_and_repair_debate(
                messages=fallback_msgs,
                frame=frame,
                language=lang,
                audience=aud,
                tool_trace=registry.trace,
                coach_proposal=proposal,
            )
            report = DialecticalDebateReport(
                messages=verification.messages,
                bianchi_proposal=proposal,
                tool_calls=list(registry.trace),
                verdict=None,
                verification=verification,
                framework=self.orchestrator.framework,
                used_llm=False,
            )

        self.last_report = report
        _simulation_cache[cache_key] = report.messages
        _simulation_report_cache[cache_key] = report
        return report.messages

    async def _run_azure_openai_debate(
        self,
        frame: MatchFramePayload,
        language: Language = DEFAULT_LANGUAGE,
        audience: Audience = DEFAULT_AUDIENCE,
    ) -> Optional[List[AgentMessage]]:
        """
        Executes the Azure OpenAI / Foundry multi-agent turn with tool calling and deterministic verification.
        """
        if not self.client:
            return None
        lang = normalize_language(language)
        aud = normalize_audience(audience)
        report = await self.orchestrator.run_debate(frame, language=lang, audience=aud, client=self.client)
        self.last_report = report
        return report.messages

    async def run_natural_language_what_if(
        self,
        request: WhatIfNLRequest | str,
        match_id: Optional[int] = None,
        event_uuid: Optional[str] = None,
        language: Language = DEFAULT_LANGUAGE,
        audience: Audience = DEFAULT_AUDIENCE,
    ) -> WhatIfNLResponse:
        """
        Executes a natural-language what-if query (e.g. '¿y si el lateral cierra por dentro?')
        using the engine tools (`xt_at`, `simulate_counterfactual`, `optimizer/solve`) and
        verified multi-agent debate.
        """
        if isinstance(request, str):
            req_obj = WhatIfNLRequest(
                query=request,
                match_id=match_id or 900001,
                event_uuid=event_uuid,
                language=normalize_language(language),
                audience=normalize_audience(audience),
            )
        else:
            req_obj = request
        self.orchestrator.client = self.client
        return await execute_natural_language_what_if(req_obj, orchestrator=self.orchestrator)


swarm = TacticalAgentSwarm()
