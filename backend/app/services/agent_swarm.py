"""
Dialectical Multi-Agent Tactical Swarm for xT-WhatIf.
Orchestrates high-level debates between:
- Dr. Voronoi (Data Scientist) [AI-QUANT]: Rigorous spatial metrics, xT grid shifts, Voronoi territory.
- Coach Bianchi (Classic Coach) [PRO-COACH]: Tactical football wisdom, rest defense, marking profiles, passing lane risks.

Features:
1. In-memory simulation cache (_simulation_cache) for sub-10ms repeat responses.
2. Async Azure OpenAI client with structured JSON parsing and 3.5s timeout.
3. Dynamic heuristic fallback that interpolates real player names, meters displaced, and optimal targets.
4. Personalisation: every debate is written for a language (en/es) and an audience profile
   (casual, analyst, coach, audio_description). Wording lives in app/services/narration.py.
"""

import json
import asyncio
import logging
from typing import List, Dict, Tuple, Optional
from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.schemas.match_contract import MatchFramePayload, AgentMessage
from app.services.narration import (
    Audience,
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    Language,
    counterfactual_debate,
    llm_system_prompt,
    llm_user_prompt,
)

logger = logging.getLogger(__name__)

# In-memory LRU-style cache for simulation debates
# Key: (event_uuid, tuple_of_sorted_modified_positions, language, audience) -> List[AgentMessage]
_simulation_cache: Dict[Tuple, List[AgentMessage]] = {}


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

    def _build_cache_key(self, frame: MatchFramePayload, language: Language = DEFAULT_LANGUAGE,
                         audience: Audience = DEFAULT_AUDIENCE) -> Tuple:
        """Creates a deterministic cache key from modified player coordinates and the narration profile."""
        mod_tuples = tuple(
            sorted(
                (p.player_id, round(p.x, 1), round(p.y, 1))
                for p in frame.players
                if p.is_modified
            )
        )
        return (frame.event_uuid, mod_tuples, language, audience)

    async def generate_debate(self, frame: MatchFramePayload, language: Language = DEFAULT_LANGUAGE,
                              audience: Audience = DEFAULT_AUDIENCE) -> List[AgentMessage]:
        """
        Generates multi-agent debate based on the simulated frame.
        Checks cache first (<10ms), tries Azure OpenAI with 3.5s timeout, and falls back to dynamic heuristics.
        """
        cache_key = self._build_cache_key(frame, language, audience)
        if cache_key in _simulation_cache:
            logger.info("Serving agent debate from in-memory simulation cache.")
            return _simulation_cache[cache_key]

        messages: Optional[List[AgentMessage]] = None

        # Attempt Azure OpenAI call if configured
        if self.client:
            try:
                messages = await asyncio.wait_for(
                    self._run_azure_openai_debate(frame, language, audience),
                    timeout=3.5
                )
            except asyncio.TimeoutError:
                logger.warning("Azure OpenAI debate call timed out (>3.5s). Falling back to dynamic heuristics.")
            except Exception as e:
                logger.warning(f"Azure OpenAI debate call failed: {e}. Falling back to dynamic heuristics.")

        # Fallback to dynamic, resilient heuristic generator
        if not messages:
            messages = counterfactual_debate(frame, language, audience)

        # Cache result
        _simulation_cache[cache_key] = messages
        return messages

    async def _run_azure_openai_debate(self, frame: MatchFramePayload, language: Language,
                                       audience: Audience) -> Optional[List[AgentMessage]]:
        """Executes a structured JSON call to Azure OpenAI generating both agent perspectives."""
        if not self.client:
            return None

        response = await self.client.chat.completions.create(
            model=settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
            messages=[
                {"role": "system", "content": llm_system_prompt(language, audience)},
                {"role": "user", "content": llm_user_prompt(frame, language)}
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


swarm = TacticalAgentSwarm()
