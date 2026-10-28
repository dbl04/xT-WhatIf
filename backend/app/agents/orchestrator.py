"""
Dialectical Multi-Agent Orchestrator for xT-WhatIf.

Implements the two-agent tactical workflow required by Persona 2:
1. Coach Bianchi (`classic_coach` / `PRO-COACH`):
   Reads the freeze-frame and proposes a concrete tactical adjustment within the 6.0m inertia ring.
2. Dr. Voronoi (`data_scientist` / `AI-QUANT`):
   Validates both the user's counterfactual move and Bianchi's proposal by calling the deterministic
   engine tools (`simulate_counterfactual`, `optimizer/solve`, `xt_at`), contrasts the numbers,
   and issues a quantitative verdict.
3. Deterministic Verifier (`app.agents.verifier`):
   Verifies every number in the final debate text against ground-truth engine metrics; repairs
   in-place or falls back to the verified template if any figure does not match.

Supported Agent Runtimes:
- Microsoft Agent Framework (`agent_framework` / `AzureOpenAIChatClient`)
- Azure AI Foundry Agent Service (`azure.ai.projects` / `azure.ai.agents`)
- Azure OpenAI Native Tool-Calling Agents (`AsyncAzureOpenAI` with `tools` & multi-turn loop)
- Deterministic Tool-Executing Agent Runtime (zero-downtime local/offline execution)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.schemas.match_contract import AgentMessage, AgentRole, MatchFramePayload
from app.services.narration import (
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    Audience,
    Language,
    bianchi_agent_system_prompt,
    counterfactual_debate,
    llm_system_prompt,
    llm_user_prompt,
    normalize_audience,
    normalize_language,
    voronoi_agent_system_prompt,
)
from app.agents.tools import (
    CoachAdjustmentProposal,
    EngineToolRegistry,
    ToolCallRecord,
    propose_coach_adjustment,
)
from app.agents.verifier import VerificationReport, verify_and_repair_debate

logger = logging.getLogger("xtwhatif.agents.orchestrator")


def detect_agent_framework() -> str:
    """Detects the highest-priority available Microsoft agent SDK in the environment."""
    try:
        import agent_framework  # type: ignore # noqa: F401
        return "microsoft-agent-framework"
    except ImportError:
        pass
    try:
        import azure.ai.projects  # type: ignore # noqa: F401
        if settings.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT:
            return "azure-ai-foundry-agent-service"
    except ImportError:
        pass
    return "azure-openai-foundry-tools"


@dataclass
class DialecticalVerdict:
    """Structured numerical comparison and verdict between Coach Bianchi and Dr. Voronoi."""
    user_simulated_xt: float
    user_xt_delta: float
    user_pass_prob: float
    bianchi_proposed_xt: float
    bianchi_pass_prob: float
    optimizer_projected_xt: float
    optimizer_pass_prob: float
    target_cell_xt: float
    disagreement_xt_gap: float
    verdict_code: str  # "adjustment_approved" | "optimizer_preferred" | "revert_move"
    summary: str


@dataclass
class DialecticalDebateReport:
    """Full execution report of a multi-agent debate turn."""
    messages: List[AgentMessage]
    bianchi_proposal: CoachAdjustmentProposal
    tool_calls: List[ToolCallRecord] = field(default_factory=list)
    verdict: Optional[DialecticalVerdict] = None
    verification: Optional[VerificationReport] = None
    framework: str = "azure-openai-foundry-tools"
    used_llm: bool = False
    model_calls: int = 0


class DialecticalAgentOrchestrator:
    """
    Orchestrates the multi-agent debate between Coach Bianchi and Dr. Voronoi:
    1. Bianchi proposes a tactical adjustment.
    2. Voronoi validates by calling `xt_at`, `simulate_counterfactual`, and `optimizer/solve`.
    3. Both agents contrast numbers and deliver a verdict.
    4. Every number is verified by the deterministic verifier before returning.
    """

    def __init__(self, client: Optional[AsyncAzureOpenAI] = None):
        self.client: Optional[AsyncAzureOpenAI] = client
        self.framework: str = detect_agent_framework()
        self.last_report: Optional[DialecticalDebateReport] = None

    async def _ensure_validation_tools_called(
        self,
        registry: EngineToolRegistry,
        frame: MatchFramePayload,
        proposal: CoachAdjustmentProposal,
        lang: Language,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Ensures Dr. Voronoi has executed all three required engine validation tools
        (`xt_at`, `simulate_counterfactual` on Bianchi's adjustment, and `optimizer/solve`)
        and returns their structured outputs.
        """
        called_names = {rec.tool_name for rec in registry.trace}
        outputs: Dict[str, Dict[str, Any]] = {}

        for rec in registry.trace:
            outputs[rec.tool_name] = rec.result

        # 1. xt_at on Bianchi's proposed cover coordinate (or ball destination)
        if "xt_at" not in called_names:
            outputs["xt_at"] = await registry.xt_at(
                x=proposal.to_x,
                y=proposal.to_y,
                language=lang,
                caller_agent="voronoi",
            )

        # 2. simulate_counterfactual testing Bianchi's proposed adjustment on top of the frame
        if "simulate_counterfactual" not in called_names:
            outputs["simulate_counterfactual"] = await registry.simulate_counterfactual(
                modified_players=[{
                    "player_id": proposal.player_id,
                    "x": proposal.to_x,
                    "y": proposal.to_y,
                }],
                event_uuid=frame.event_uuid,
                include_bound_modifications=True,
                caller_agent="voronoi",
            )

        # 3. optimizer/solve to find the mathematical inverse optimum
        if "optimizer/solve" not in called_names and "optimizer_solve" not in called_names:
            outputs["optimizer/solve"] = await registry.optimizer_solve(
                max_defenders_to_move=2,
                max_radius_meters=5.8,
                event_uuid=frame.event_uuid,
                caller_agent="voronoi",
            )

        return outputs

    def _build_verdict(
        self,
        frame: MatchFramePayload,
        proposal: CoachAdjustmentProposal,
        tool_outputs: Dict[str, Dict[str, Any]],
        lang: Language,
    ) -> DialecticalVerdict:
        """Computes the quantitative disagreement and final verdict from the tool outputs."""
        m = frame.metrics
        sim_out = tool_outputs.get("simulate_counterfactual", {})
        opt_out = tool_outputs.get("optimizer/solve") or tool_outputs.get("optimizer_solve") or {}
        xt_out = tool_outputs.get("xt_at", {})

        bianchi_xt = float(sim_out.get("simulated_xt", m.simulated_xt))
        bianchi_prob = float(sim_out.get("pass_completion_prob", m.pass_completion_prob))

        opt_pm = opt_out.get("projected_metrics", {})
        opt_xt = float(opt_pm.get("simulated_xt", m.simulated_xt))
        opt_prob = float(opt_pm.get("pass_completion_prob", m.pass_completion_prob))

        cell_xt = float(xt_out.get("xt_rounded", get_default_xt := m.simulated_xt))
        gap = round(bianchi_xt - opt_xt, 2)

        if m.xt_delta < 0 and bianchi_xt <= m.simulated_xt + 0.01:
            code = "adjustment_approved"
        elif opt_xt < bianchi_xt - 0.01:
            code = "optimizer_preferred"
        elif m.xt_delta > 0:
            code = "revert_move"
        else:
            code = "adjustment_approved"

        if lang == "es":
            summary = (
                f"Bianchi propone mover a {proposal.player_name} {proposal.displacement_m:.1f} m a "
                f"({proposal.to_x:.1f}, {proposal.to_y:.1f}) -> xT={bianchi_xt:.2f} (Prob. pase {bianchi_prob:.1f}%). "
                f"Voronoi contrasta con optimizer/solve -> xT={opt_xt:.2f} (Prob. pase {opt_prob:.1f}%, "
                f"xt_at={cell_xt:.2f}). Veredicto: {code}."
            )
        else:
            summary = (
                f"Bianchi proposes moving {proposal.player_name} {proposal.displacement_m:.1f} m to "
                f"({proposal.to_x:.1f}, {proposal.to_y:.1f}) -> xT={bianchi_xt:.2f} (Pass prob. {bianchi_prob:.1f}%). "
                f"Voronoi contrasts with optimizer/solve -> xT={opt_xt:.2f} (Pass prob. {opt_prob:.1f}%, "
                f"xt_at={cell_xt:.2f}). Verdict: {code}."
            )

        return DialecticalVerdict(
            user_simulated_xt=round(m.simulated_xt, 2),
            user_xt_delta=round(m.xt_delta, 2),
            user_pass_prob=round(m.pass_completion_prob, 1),
            bianchi_proposed_xt=round(bianchi_xt, 2),
            bianchi_pass_prob=round(bianchi_prob, 1),
            optimizer_projected_xt=round(opt_xt, 2),
            optimizer_pass_prob=round(opt_prob, 1),
            target_cell_xt=round(cell_xt, 2),
            disagreement_xt_gap=gap,
            verdict_code=code,
            summary=summary,
        )

    async def _run_llm_multi_agent_turns(
        self,
        client: AsyncAzureOpenAI,
        frame: MatchFramePayload,
        registry: EngineToolRegistry,
        proposal: CoachAdjustmentProposal,
        tool_outputs: Dict[str, Dict[str, Any]],
        lang: Language,
        audience: Audience,
    ) -> Optional[List[AgentMessage]]:
        """
        Executes the multi-agent LLM orchestration using Azure OpenAI / Foundry function calling:
        - Allows Dr. Voronoi (`AZURE_OPENAI_DEPLOYMENT_REASONING`) to call `simulate_counterfactual`,
          `optimizer_solve`, and `xt_at` via tool-calling and synthesize the dialectical debate
          with Coach Bianchi (`AZURE_OPENAI_DEPLOYMENT_COACH`).
        - Also supports single-turn `{"debate": [...]}` JSON responses for backward compatibility.
        """
        user_ctx = llm_user_prompt(frame, lang)
        opt_pm = (tool_outputs.get("optimizer/solve") or {}).get("projected_metrics", {})
        sim_out = tool_outputs.get("simulate_counterfactual", {})
        xt_out = tool_outputs.get("xt_at", {})

        dialectical_context = (
            f"{user_ctx}\n"
            f"Coach Bianchi's Proposed Adjustment:\n"
            f"- Move {proposal.player_name} (ID {proposal.player_id}, #{proposal.jersey_number}) "
            f"{proposal.displacement_m:.1f}m from ({proposal.from_x:.1f}, {proposal.from_y:.1f}) "
            f"to ({proposal.to_x:.1f}, {proposal.to_y:.1f}): {proposal.rationale}\n"
            f"Dr. Voronoi's Engine Tool Validation Results:\n"
            f"- xt_at({proposal.to_x:.1f}, {proposal.to_y:.1f}): {xt_out.get('xt_rounded', frame.metrics.simulated_xt):.2f} xT\n"
            f"- simulate_counterfactual(Bianchi proposal): simulated_xt={sim_out.get('simulated_xt', frame.metrics.simulated_xt):.2f}, "
            f"pass_completion_prob={sim_out.get('pass_completion_prob', frame.metrics.pass_completion_prob):.1f}%\n"
            f"- optimizer/solve: projected_xt={opt_pm.get('simulated_xt', frame.metrics.simulated_xt):.2f}, "
            f"pass_completion_prob={opt_pm.get('pass_completion_prob', frame.metrics.pass_completion_prob):.1f}%\n"
        )

        messages_history: List[Dict[str, Any]] = [
            {"role": "system", "content": llm_system_prompt(lang, audience)},
            {"role": "user", "content": dialectical_context},
        ]

        self._last_turn_model_calls = 0
        # Call reasoning deployment with tools enabled if supported by the client
        try:
            self._last_turn_model_calls += 1
            response = await client.chat.completions.create(
                model=settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
                messages=messages_history,
                tools=EngineToolRegistry.get_openai_tools(),
                tool_choice="auto",
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=700,
            )
        except TypeError:
            # Fallback if a mock client does not accept `tools` keyword argument
            response = await client.chat.completions.create(
                model=settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
                messages=messages_history,
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=700,
            )

        choice_msg = response.choices[0].message
        tool_calls = getattr(choice_msg, "tool_calls", None)

        # If the model invoked tools, execute each tool against EngineToolRegistry and complete the turn
        if tool_calls:
            messages_history.append({
                "role": "assistant",
                "content": choice_msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            })
            for tc in tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    fn_args = {}
                try:
                    tool_res = await registry.execute_tool(fn_name, fn_args, caller_agent="voronoi-llm")
                except Exception as exc:
                    tool_res = {"error": str(exc)}
                messages_history.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(tool_res),
                })

            self._last_turn_model_calls += 1
            followup = await client.chat.completions.create(
                model=settings.AZURE_OPENAI_DEPLOYMENT_REASONING,
                messages=messages_history,
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=700,
            )
            content = followup.choices[0].message.content
        else:
            content = choice_msg.content

        if not content:
            return None

        parsed = json.loads(content)
        debate_list = parsed.get("debate", [])
        if len(debate_list) >= 2:
            return [AgentMessage(**item) for item in debate_list]
        return None

    async def run_debate(
        self,
        frame: MatchFramePayload,
        language: Language = DEFAULT_LANGUAGE,
        audience: Audience = DEFAULT_AUDIENCE,
        client: Optional[AsyncAzureOpenAI] = None,
    ) -> DialecticalDebateReport:
        """
        Executes the full multi-agent workflow:
        1. Coach Bianchi proposes a tactical adjustment.
        2. Dr. Voronoi validates it by calling `xt_at`, `simulate_counterfactual`, and `optimizer/solve`.
        3. If an Azure OpenAI / Foundry client is available, executes the LLM agent turns.
        4. Runs the deterministic numerical verifier (`verify_and_repair_debate`) so every figure
           is guaranteed to match the engine's metrics (or is repaired / fallen back to template).
        """
        lang = normalize_language(language)
        aud = normalize_audience(audience)
        active_client = client or self.client

        registry = EngineToolRegistry(bound_frame=frame)

        # Turn 1: Coach Bianchi proposes a tactical adjustment within the 6.0m inertia ring
        proposal = propose_coach_adjustment(frame, lang)

        # Turn 2: Dr. Voronoi validates via the 3 engine tools
        tool_outputs = await self._ensure_validation_tools_called(registry, frame, proposal, lang)

        # Turn 3: Optional LLM multi-agent generation
        llm_messages: Optional[List[AgentMessage]] = None
        used_llm = False
        model_calls = 0
        if active_client is not None:
            try:
                self._last_turn_model_calls = 0
                llm_messages = await self._run_llm_multi_agent_turns(
                    client=active_client,
                    frame=frame,
                    registry=registry,
                    proposal=proposal,
                    tool_outputs=tool_outputs,
                    lang=lang,
                    audience=aud,
                )
                model_calls = getattr(self, "_last_turn_model_calls", 0)
                used_llm = llm_messages is not None
            except Exception as exc:
                model_calls = getattr(self, "_last_turn_model_calls", 0)
                logger.warning("Multi-agent LLM turn failed (%s); falling back to verified template.", exc)
                llm_messages = None

        # Turn 4: Deterministic numerical verification (repairs or falls back to template)
        if llm_messages is not None:
            verification = verify_and_repair_debate(
                messages=llm_messages,
                frame=frame,
                language=lang,
                audience=aud,
                tool_trace=registry.trace,
                coach_proposal=proposal,
            )
        else:
            template_msgs = counterfactual_debate(
                frame, lang, aud, tool_trace=registry.trace, coach_proposal=proposal
            )
            verification = verify_and_repair_debate(
                messages=template_msgs,
                frame=frame,
                language=lang,
                audience=aud,
                tool_trace=registry.trace,
                coach_proposal=proposal,
            )

        verdict = self._build_verdict(frame, proposal, tool_outputs, lang)
        report = DialecticalDebateReport(
            messages=verification.messages,
            bianchi_proposal=proposal,
            tool_calls=list(registry.trace),
            verdict=verdict,
            verification=verification,
            framework=self.framework,
            used_llm=used_llm,
            model_calls=model_calls,
        )
        self.last_report = report
        return report
