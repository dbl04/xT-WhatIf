"""
Deterministic Numerical Verifier for xT-WhatIf Agent Debate.

Requirement:
"Verificador determinista: cada cifra del texto del LLM debe coincidir con las métricas;
si no, se corrige o cae a plantilla."

How it works:
1. Builds the ground-truth numerical set from `MatchFramePayload.metrics`, moved player displacements/coordinates,
   and any engine tool results (`simulate_counterfactual`, `optimizer/solve`, `xt_at`).
2. Scans every numeric token in `headline`, `analysis_body`, and `referenced_metric` of each `AgentMessage`.
3. If every number matches a ground-truth metric (within rounding tolerance), the message passes untouched.
4. If a number mismatches its metric, attempts deterministic contextual correction (e.g. replacing a wrong
   `ΔxT`, `xT`, `pass_completion_prob %`, `space_control_home_pct %`, or displacement `m` with the exact
   ground-truth figure) and re-verifies.
5. If any unverified/hallucinated number remains after contextual repair (or if audience constraints such as
   no coordinates in `audio_description` are violated), deterministically falls back to the verified template
   from `app.services.narration.counterfactual_debate`.
"""

from __future__ import annotations

import re
import math
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from app.schemas.match_contract import AgentMessage, AgentRole, MatchFramePayload
from app.services.narration import (
    AGENT_NAMES,
    BADGES,
    DEFAULT_AUDIENCE,
    DEFAULT_LANGUAGE,
    SIMULATION_TAG,
    Audience,
    Language,
    counterfactual_debate,
    delta_context,
    normalize_audience,
    normalize_language,
)
from app.agents.tools import CoachAdjustmentProposal, ToolCallRecord

logger = logging.getLogger("xtwhatif.agents.verifier")

# Regex to strip fixed structural tokens that are not dynamic metrics (e.g. 16x12 grid, 120x80 pitch, #5 jersey, 360)
_STRUCTURAL_TOKEN_RE = re.compile(
    r"(?:\b16\s*x\s*12\b|\b120\s*x\s*80\b|\b60\s*x\s*40\b|\b1\s*v\s*1\b|#\d+|\b360\b|\b\d{1,2}:\d{2}\b)",
    re.IGNORECASE,
)

# Regex matching numeric literals (with optional leading +/- and decimal part)
_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_#])([+-]?\d+(?:\.\d+)?)(?![A-Za-z0-9_])")


@dataclass
class VerificationReport:
    """Detailed audit report returned by the deterministic verifier."""
    messages: List[AgentMessage]
    all_matched_initially: bool = True
    corrected_in_place: bool = False
    fell_back_to_template: bool = False
    mismatches: List[str] = field(default_factory=list)
    corrections: List[Tuple[str, str]] = field(default_factory=list)


def _pct(xt: float) -> int:
    return int(round(xt * 100))


def collect_ground_truth_numbers(
    frame: MatchFramePayload,
    tool_trace: Optional[List[ToolCallRecord]] = None,
    coach_proposal: Optional[CoachAdjustmentProposal] = None,
) -> Dict[str, Any]:
    """
    Extracts canonical ground-truth values and the set of all valid numbers from the frame
    and executed engine tools.
    """
    m = frame.metrics
    ctx = delta_context(frame, "es")
    mod = ctx["modified"][0] if ctx["modified"] else None

    dist = 0.0
    mx, my, ox, oy = 0.0, 0.0, 0.0, 0.0
    if mod is not None:
        mx, my = round(mod.x, 1), round(mod.y, 1)
        ox = round(mod.original_x if mod.original_x is not None else mod.x, 1)
        oy = round(mod.original_y if mod.original_y is not None else mod.y, 1)
        dist = round(math.hypot(mod.x - ox, mod.y - oy), 1)

    rel_pct_trunc = abs(int((m.xt_delta / max(0.01, m.original_xt)) * 100))
    rel_pct_round = abs(int(round((m.xt_delta / max(0.01, m.original_xt)) * 100)))
    orig_pct = _pct(m.original_xt)
    sim_pct = _pct(m.simulated_xt)

    # Small decimal metrics (xT and delta xT)
    xt_numbers: Set[float] = {
        0.0,
        round(m.original_xt, 2),
        round(m.original_xt, 3),
        round(m.original_xt, 4),
        round(m.simulated_xt, 2),
        round(m.simulated_xt, 3),
        round(m.simulated_xt, 4),
        round(m.xt_delta, 2),
        round(abs(m.xt_delta), 2),
        round(m.xt_delta, 3),
        round(abs(m.xt_delta), 3),
    }

    # Larger numbers (percentages, meters, coordinates, jersey numbers, structural tactical constants)
    general_numbers: Set[float] = {
        0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 12.0, 16.0, 80.0, 120.0, 360.0,
        round(m.pass_completion_prob, 1),
        float(int(round(m.pass_completion_prob))),
        round(m.space_control_home_pct, 1),
        float(int(round(m.space_control_home_pct))),
        float(rel_pct_trunc),
        float(rel_pct_round),
        float(orig_pct),
        float(sim_pct),
        float(abs(sim_pct - orig_pct)),
        dist,
        float(int(round(dist))),
        mx, my, ox, oy,
        float(frame.minute),
        float(frame.second),
    }

    # Include all modified players' displacements and coordinates, plus actor, receiver, optimal, presser
    actor = ctx["actor"]
    defenders = [p for p in frame.players if p.team != frame.possession_team and not p.is_keeper]
    if defenders:
        presser = min(defenders, key=lambda p: math.hypot(p.x - actor.x, p.y - actor.y))
        press_gap = math.hypot(presser.x - actor.x, presser.y - actor.y)
        general_numbers.add(round(press_gap, 1))
        general_numbers.add(float(max(1, int(round(press_gap)))))

    for p in frame.players:
        if p.is_modified or p.is_actor or p.player_id in (ctx["receiver_id"], ctx["optimal_id"]):
            general_numbers.add(round(p.x, 1))
            general_numbers.add(round(p.y, 1))
            general_numbers.add(float(p.jersey_number))
            general_numbers.add(float(p.player_id))
            goal_dist = math.hypot(120.0 - p.x, 40.0 - p.y)
            general_numbers.add(float(max(5, int(round(goal_dist / 5.0) * 5))))
            if p.original_x is not None and p.original_y is not None:
                d_p = math.hypot(p.x - p.original_x, p.y - p.original_y)
                general_numbers.add(round(d_p, 1))
                general_numbers.add(float(int(round(d_p))))

    # Include numbers from Coach Bianchi's proposal if present
    opt_sim_xt: Optional[float] = None
    opt_delta_xt: Optional[float] = None
    opt_pass_prob: Optional[float] = None
    bianchi_sim_xt: Optional[float] = None
    bianchi_pass_prob: Optional[float] = None

    if coach_proposal is not None:
        general_numbers.update({
            round(coach_proposal.displacement_m, 1),
            float(int(round(coach_proposal.displacement_m))),
            round(coach_proposal.to_x, 1),
            round(coach_proposal.to_y, 1),
            round(coach_proposal.from_x, 1),
            round(coach_proposal.from_y, 1),
            float(coach_proposal.jersey_number),
            float(coach_proposal.player_id),
        })

    # Include numbers returned by any executed engine tools (simulate_counterfactual, optimizer/solve, xt_at)
    for rec in tool_trace or []:
        res = rec.result or {}
        if rec.tool_name == "xt_at":
            if "xt" in res:
                xt_numbers.add(round(float(res["xt"]), 4))
                xt_numbers.add(round(float(res["xt"]), 2))
            if "goal_probability_pct" in res:
                general_numbers.add(float(res["goal_probability_pct"]))
            if "x" in res and "y" in res:
                general_numbers.add(round(float(res["x"]), 1))
                general_numbers.add(round(float(res["y"]), 1))
        elif rec.tool_name == "simulate_counterfactual":
            for k in ("original_xt", "simulated_xt", "xt_delta", "action_value_ev"):
                if k in res and res[k] is not None:
                    val = float(res[k])
                    xt_numbers.add(round(val, 2))
                    xt_numbers.add(round(abs(val), 2))
            if "simulated_xt" in res:
                bianchi_sim_xt = round(float(res["simulated_xt"]), 2)
                general_numbers.add(float(_pct(bianchi_sim_xt)))
            if "pass_completion_prob" in res:
                bianchi_pass_prob = round(float(res["pass_completion_prob"]), 1)
                general_numbers.add(bianchi_pass_prob)
                general_numbers.add(float(int(round(bianchi_pass_prob))))
            if "space_control_home_pct" in res:
                general_numbers.add(round(float(res["space_control_home_pct"]), 1))
            if "relative_xt_change_pct" in res:
                general_numbers.add(float(res["relative_xt_change_pct"]))
            for mp in res.get("moved_players", []):
                general_numbers.add(round(float(mp.get("displacement_m", 0.0)), 1))
                general_numbers.add(round(float(mp.get("to_x", 0.0)), 1))
                general_numbers.add(round(float(mp.get("to_y", 0.0)), 1))
        elif rec.tool_name in ("optimizer/solve", "optimizer_solve"):
            pm = res.get("projected_metrics", {})
            for k in ("original_xt", "simulated_xt", "xt_delta"):
                if k in pm and pm[k] is not None:
                    val = float(pm[k])
                    xt_numbers.add(round(val, 2))
                    xt_numbers.add(round(abs(val), 2))
            if "simulated_xt" in pm:
                opt_sim_xt = round(float(pm["simulated_xt"]), 2)
                general_numbers.add(float(_pct(opt_sim_xt)))
            if "xt_delta" in pm:
                opt_delta_xt = round(float(pm["xt_delta"]), 2)
            if "pass_completion_prob" in pm:
                opt_pass_prob = round(float(pm["pass_completion_prob"]), 1)
                general_numbers.add(opt_pass_prob)
                general_numbers.add(float(int(round(opt_pass_prob))))
            if "space_control_home_pct" in pm:
                general_numbers.add(round(float(pm["space_control_home_pct"]), 1))
            for adj in res.get("adjustments", []):
                general_numbers.add(round(float(adj.get("displacement_m", 0.0)), 1))
                general_numbers.add(round(float(adj.get(" displacement_m", adj.get("displacement_m", 0.0))), 2))
                general_numbers.add(round(float(adj.get("to_x", 0.0)), 1))
                general_numbers.add(round(float(adj.get("to_y", 0.0)), 1))

    return {
        "xt_numbers": xt_numbers,
        "general_numbers": general_numbers,
        "original_xt": round(m.original_xt, 2),
        "simulated_xt": round(m.simulated_xt, 2),
        "xt_delta": round(m.xt_delta, 2),
        "orig_pct": orig_pct,
        "sim_pct": sim_pct,
        "rel_pct": rel_pct_trunc,
        "pass_prob": round(m.pass_completion_prob, 1),
        "space_ctrl": round(m.space_control_home_pct, 1),
        "dist": dist,
        "mx": mx,
        "my": my,
        "opt_sim_xt": opt_sim_xt,
        "opt_delta_xt": opt_delta_xt,
        "opt_pass_prob": opt_pass_prob,
        "bianchi_sim_xt": bianchi_sim_xt,
        "bianchi_pass_prob": bianchi_pass_prob,
    }


def is_number_verified(val: float, raw_token: str, truth: Dict[str, Any]) -> bool:
    """
    Checks whether a numeric literal `val` matches any ground-truth metric in `truth`.
    - Decimal numbers in (-1.0, 1.0) with a decimal point (e.g. 0.24, -0.08) are checked
      against `xt_numbers` within ±0.015.
    - Numbers outside (-1.0, 1.0) or integers are checked against `general_numbers` within ±0.6.
    """
    abs_val = abs(val)
    if "." in raw_token and abs_val < 1.0:
        for gt in truth["xt_numbers"]:
            if abs(val - gt) <= 0.015 or abs(abs_val - abs(gt)) <= 0.015:
                return True
        return False

    for gt in truth["general_numbers"]:
        if abs(val - gt) <= 0.6 or abs(abs_val - abs(gt)) <= 0.6:
            return True
    # Also check xt_numbers in case original_xt/simulated_xt is 0
    if abs_val < 1.0:
        for gt in truth["xt_numbers"]:
            if abs(val - gt) <= 0.015:
                return True
    return False


def extract_unverified_numbers(text: str, truth: Dict[str, Any]) -> List[Tuple[str, float]]:
    """Returns a list of `(raw_token, float_val)` in `text` that do not match ground truth."""
    masked = _STRUCTURAL_TOKEN_RE.sub(" ", text)
    mismatches: List[Tuple[str, float]] = []
    for match in _NUMBER_RE.finditer(masked):
        raw = match.group(1)
        try:
            val = float(raw)
        except ValueError:
            continue
        if not is_number_verified(val, raw, truth):
            mismatches.append((raw, val))
    return mismatches


def repair_text_numbers(
    text: str,
    truth: Dict[str, Any],
) -> Tuple[str, List[Tuple[str, str]]]:
    """
    Deterministically repairs recognizable metric patterns in `text` where the LLM wrote
    an inaccurate figure (e.g. wrong xT range, wrong ΔxT, wrong pass probability %, wrong Voronoi %).
    Returns `(repaired_text, list_of_replacements)`.
    """
    repaired = text
    corrections: List[Tuple[str, str]] = []

    orig_str = f"{truth['original_xt']:.2f}"
    sim_str = f"{truth['simulated_xt']:.2f}"
    delta_str = f"{truth['xt_delta']:+.2f}"
    prob_str = f"{truth['pass_prob']:.1f}"
    ctrl_str = f"{truth['space_ctrl']:.1f}"
    dist_str = f"{truth['dist']:.1f}"
    rel_pct_str = str(truth["rel_pct"])
    orig_pct_str = str(truth["orig_pct"])
    sim_pct_str = str(truth["sim_pct"])

    # 1. Repair xT transition ranges: "from 0.XX to 0.YY" / "de 0.XX a 0.YY" / "0.XX -> 0.YY"
    range_xt_re = re.compile(
        r"\b(from|de)\s+([01]\.\d{1,3})\s+(to|a)\s+([01]\.\d{1,3})\b",
        re.IGNORECASE,
    )
    def _fix_xt_range(m: re.Match) -> str:
        w1, n1, w2, n2 = m.group(1), m.group(2), m.group(3), m.group(4)
        new_n1, new_n2 = orig_str, sim_str
        if n1 != new_n1:
            corrections.append((n1, new_n1))
        if n2 != new_n2:
            corrections.append((n2, new_n2))
        return f"{w1} {new_n1} {w2} {new_n2}"

    repaired = range_xt_re.sub(_fix_xt_range, repaired)

    # 2. Repair percentage goal-threat ranges: "from XX% to YY%" / "del XX% al YY%" / "XX% → YY%"
    range_pct_re = re.compile(
        r"(\b(?:from|del)\s+)(\d{1,3})(%?\s+(?:to|al)\s+)(\d{1,3})(\s*(?:%|percent|por ciento))",
        re.IGNORECASE,
    )
    def _fix_pct_range(m: re.Match) -> str:
        p1, n1, p2, n2, p3 = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if not is_number_verified(float(n1), n1, truth) or not is_number_verified(float(n2), n2, truth):
            corrections.append((f"{n1}->{n2}", f"{orig_pct_str}->{sim_pct_str}"))
            return f"{p1}{orig_pct_str}{p2}{sim_pct_str}{p3}"
        return m.group(0)

    repaired = range_pct_re.sub(_fix_pct_range, repaired)

    # 3. Repair labeled ΔxT: "ΔxT: +0.XX" / "ΔxT -0.XX" / "Δ +0.XX"
    delta_re = re.compile(r"(ΔxT\s*:?\s*|Δ\s+)([+-]?\d+\.\d{1,3})")
    def _fix_delta(m: re.Match) -> str:
        prefix, num = m.group(1), m.group(2)
        if not is_number_verified(float(num), num, truth):
            corrections.append((num, delta_str))
            return f"{prefix}{delta_str}"
        return m.group(0)

    repaired = delta_re.sub(_fix_delta, repaired)

    # 4. Repair standalone xT values next to "xT" label: "0.XX xT" or "xT: 0.XX" or "xT de 0.XX"
    xt_after_re = re.compile(r"\b(xT(?:\s+de|\s*:)?\s+)([+-]?\d+\.\d{1,3})\b")
    def _fix_xt_after(m: re.Match) -> str:
        prefix, num = m.group(1), m.group(2)
        if not is_number_verified(float(num), num, truth):
            corrections.append((num, sim_str))
            return f"{prefix}{sim_str}"
        return m.group(0)

    repaired = xt_after_re.sub(_fix_xt_after, repaired)

    xt_before_re = re.compile(r"([+-]?\d+\.\d{1,3})(\s+xT\b)")
    def _fix_xt_before(m: re.Match) -> str:
        num, suffix = m.group(1), m.group(2)
        if not is_number_verified(float(num), num, truth):
            target = delta_str if num.startswith(("+", "-")) else sim_str
            corrections.append((num, target))
            return f"{target}{suffix}"
        return m.group(0)

    repaired = xt_before_re.sub(_fix_xt_before, repaired)

    # 5. Repair remaining unverified numbers by inspecting local context window
    def _contextual_sub(m: re.Match) -> str:
        raw = m.group(1)
        start, end = m.span(1)
        # Skip if part of structural token (#5, 16x12, etc.)
        window_tight = repaired[max(0, start - 4):min(len(repaired), end + 4)]
        if _STRUCTURAL_TOKEN_RE.search(window_tight):
            return raw

        try:
            val = float(raw)
        except ValueError:
            return raw

        if is_number_verified(val, raw, truth):
            return raw

        before_ctx = repaired[max(0, start - 42):start].lower()
        after_ctx = repaired[end:min(len(repaired), end + 16)].lower()
        ctx_window = before_ctx + " " + after_ctx
        after_char = repaired[end:end + 2]

        # Percentage context: pick the metric whose keyword is closest before the number
        if after_char.startswith("%") or "percent" in after_ctx or "por ciento" in after_ctx:
            ctrl_pos = max((before_ctx.rfind(k) for k in ("voronoi", "control", "dominio", "space", "territorial")), default=-1)
            prob_pos = max((before_ctx.rfind(k) for k in ("prob", "pase", "pass", "acierto", "complet", "llegar", "arriving")), default=-1)
            rel_pos = max((before_ctx.rfind(k) for k in ("relativ", "colapso", "collaps", "baja un", "reduce", "down", "cuts")), default=-1)
            goal_pos = max((before_ctx.rfind(k) for k in ("gol", "goal", "peligro", "danger", "threat")), default=-1)

            best_pos = max(ctrl_pos, prob_pos, rel_pos, goal_pos)
            if best_pos >= 0:
                if best_pos == ctrl_pos:
                    corrections.append((raw, ctrl_str))
                    return ctrl_str
                if best_pos == prob_pos:
                    corrections.append((raw, prob_str))
                    return prob_str
                if best_pos == rel_pos:
                    sign = "-" if raw.startswith("-") else ""
                    corrections.append((raw, f"{sign}{rel_pct_str}"))
                    return f"{sign}{rel_pct_str}"
                if best_pos == goal_pos:
                    corrections.append((raw, sim_pct_str))
                    return sim_pct_str
            # Check immediate after_ctx if keyword follows the percentage (e.g. "-28% en xT relativo")
            if any(k in after_ctx for k in ("relativ", "xt")):
                sign = "-" if raw.startswith("-") else ""
                corrections.append((raw, f"{sign}{rel_pct_str}"))
                return f"{sign}{rel_pct_str}"
            if any(k in after_ctx for k in ("pase", "pass", "prob", "acierto")):
                corrections.append((raw, prob_str))
                return prob_str
            if any(k in after_ctx for k in ("voronoi", "control", "dominio", "space")):
                corrections.append((raw, ctrl_str))
                return ctrl_str

        # Displacement in meters context
        if any(k in ctx_window for k in ("metros", "metres", "desplaz", "mov", "shift", "slide")):
            if truth["dist"] > 0:
                corrections.append((raw, dist_str))
                return dist_str

        # Small decimal in [0, 1] -> simulated_xt or xt_delta
        if "." in raw and abs(val) < 1.0:
            target = delta_str if raw.startswith(("+", "-")) else sim_str
            corrections.append((raw, target))
            return target

        return raw

    repaired = _NUMBER_RE.sub(_contextual_sub, repaired)
    return repaired, corrections


def verify_and_repair_debate(
    messages: Optional[List[AgentMessage]],
    frame: MatchFramePayload,
    language: Language = DEFAULT_LANGUAGE,
    audience: Audience = DEFAULT_AUDIENCE,
    tool_trace: Optional[List[ToolCallRecord]] = None,
    coach_proposal: Optional[CoachAdjustmentProposal] = None,
) -> VerificationReport:
    """
    Verifies every number in the LLM-generated `messages` against ground-truth metrics.
    - If a number does not match, repairs it in place using contextual rules.
    - If any unverified number remains (or `messages` is empty/malformed), falls back to the
      deterministic template (`counterfactual_debate`).
    """
    lang = normalize_language(language)
    aud = normalize_audience(audience)
    template_messages = counterfactual_debate(
        frame, lang, aud, tool_trace=tool_trace, coach_proposal=coach_proposal
    )
    template_by_role = {m.agent_role: m for m in template_messages}

    if not messages or len(messages) < 2:
        return VerificationReport(
            messages=template_messages,
            all_matched_initially=False,
            corrected_in_place=False,
            fell_back_to_template=True,
            mismatches=["missing_or_incomplete_llm_messages"],
        )

    truth = collect_ground_truth_numbers(frame, tool_trace=tool_trace, coach_proposal=coach_proposal)
    valid_player_ids = {p.player_id for p in frame.players}
    clock = f"{frame.minute}:{frame.second:02d} [{SIMULATION_TAG[lang]}]"

    verified_out: List[AgentMessage] = []
    all_matched_initially = True
    corrected_in_place = False
    fell_back_to_template = False
    all_mismatches: List[str] = []
    all_corrections: List[Tuple[str, str]] = []

    # Ensure canonical ordering: [DATA_SCIENTIST, CLASSIC_COACH]
    by_role: Dict[AgentRole, AgentMessage] = {}
    for msg in messages:
        by_role[msg.agent_role] = msg

    for role in (AgentRole.DATA_SCIENTIST, AgentRole.CLASSIC_COACH):
        candidate = by_role.get(role)
        fallback_msg = template_by_role[role]
        if candidate is None:
            all_matched_initially = False
            fell_back_to_template = True
            all_mismatches.append(f"missing_role:{role.value}")
            verified_out.append(fallback_msg)
            continue

        # Check audience constraints for audio_description (no coordinates or 'xT' jargon)
        if aud == "audio_description" and (
            "(" in candidate.analysis_body or "xT" in candidate.analysis_body
        ):
            all_matched_initially = False
            fell_back_to_template = True
            all_mismatches.append(f"{role.value}:audio_description_jargon_violation")
            verified_out.append(fallback_msg)
            continue

        fields_to_check = ("headline", "analysis_body", "referenced_metric")
        repaired_fields: Dict[str, str] = {}
        msg_had_mismatch = False

        for fname in fields_to_check:
            raw_text = getattr(candidate, fname, "") or ""
            if not raw_text.strip():
                msg_had_mismatch = True
                all_mismatches.append(f"{role.value}.{fname}:empty")
                break

            initial_bad = extract_unverified_numbers(raw_text, truth)
            if initial_bad:
                all_matched_initially = False
                for tok, _ in initial_bad:
                    all_mismatches.append(f"{role.value}.{fname}:{tok}")
                fixed_text, fixes = repair_text_numbers(raw_text, truth)
                if fixes:
                    corrected_in_place = True
                    all_corrections.extend(fixes)
                remaining_bad = extract_unverified_numbers(fixed_text, truth)
                if remaining_bad:
                    msg_had_mismatch = True
                    logger.warning(
                        "Deterministic verifier: unverified numbers %s remain in %s.%s; falling back to template.",
                        remaining_bad,
                        role.value,
                        fname,
                    )
                    break
                repaired_fields[fname] = fixed_text
            else:
                repaired_fields[fname] = raw_text

        if msg_had_mismatch or len(repaired_fields) < 3:
            fell_back_to_template = True
            verified_out.append(fallback_msg)
            continue

        # Validate highlighted_player_ids against frame players
        clean_ids = [pid for pid in (candidate.highlighted_player_ids or []) if pid in valid_player_ids]
        if not clean_ids:
            clean_ids = list(fallback_msg.highlighted_player_ids)

        verified_out.append(
            AgentMessage(
                message_id=candidate.message_id or fallback_msg.message_id,
                agent_role=role,
                agent_name=AGENT_NAMES[lang][role],
                avatar_badge=BADGES[role],
                timestamp_label=clock,
                headline=repaired_fields["headline"],
                analysis_body=repaired_fields["analysis_body"],
                referenced_metric=repaired_fields["referenced_metric"],
                highlighted_player_ids=clean_ids,
            )
        )

    return VerificationReport(
        messages=verified_out,
        all_matched_initially=all_matched_initially,
        corrected_in_place=corrected_in_place,
        fell_back_to_template=fell_back_to_template,
        mismatches=all_mismatches,
        corrections=all_corrections,
    )
