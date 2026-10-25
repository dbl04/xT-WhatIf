"""
xT-WhatIf Multi-Agent Package (`backend/app/agents/`).

Provides:
- `EngineToolRegistry`, `CoachAdjustmentProposal`, `ToolCallRecord`, `propose_coach_adjustment`
- `DialecticalAgentOrchestrator`, `DialecticalDebateReport`, `DialecticalVerdict`, `detect_agent_framework`
- `verify_and_repair_debate`, `VerificationReport`, `collect_ground_truth_numbers`
- `WhatIfNLRequest`, `WhatIfNLResponse`, `InterpretedWhatIfMove`, `execute_natural_language_what_if`, `interpret_natural_language_move`
"""

from app.agents.tools import (
    CoachAdjustmentProposal,
    EngineToolRegistry,
    ToolCallRecord,
    propose_coach_adjustment,
    resolve_frame,
)
from app.agents.verifier import (
    VerificationReport,
    collect_ground_truth_numbers,
    extract_unverified_numbers,
    is_number_verified,
    repair_text_numbers,
    verify_and_repair_debate,
)
from app.agents.orchestrator import (
    DialecticalAgentOrchestrator,
    DialecticalDebateReport,
    DialecticalVerdict,
    detect_agent_framework,
)
from app.agents.what_if_nl import (
    InterpretedWhatIfMove,
    WhatIfNLRequest,
    WhatIfNLResponse,
    execute_natural_language_what_if,
    interpret_natural_language_move,
    router as agents_router,
)

__all__ = [
    "CoachAdjustmentProposal",
    "EngineToolRegistry",
    "ToolCallRecord",
    "propose_coach_adjustment",
    "resolve_frame",
    "VerificationReport",
    "collect_ground_truth_numbers",
    "extract_unverified_numbers",
    "is_number_verified",
    "repair_text_numbers",
    "verify_and_repair_debate",
    "DialecticalAgentOrchestrator",
    "DialecticalDebateReport",
    "DialecticalVerdict",
    "detect_agent_framework",
    "InterpretedWhatIfMove",
    "WhatIfNLRequest",
    "WhatIfNLResponse",
    "execute_natural_language_what_if",
    "interpret_natural_language_move",
    "agents_router",
]
