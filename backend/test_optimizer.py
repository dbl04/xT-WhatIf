"""
Automated Test Suite for Auto-Coach AI (Tactical Optimizer).
Tests optimization on Highlight 2 (Min 35:42 - Di María goal).
Validates that displacements stay within the 6.0m physical inertia limit and threat is reduced.
"""

import sys
import asyncio
import time
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.schemas.match_contract import MatchFramePayload
from app.services.statsbomb_loader import loader
from app.services.tactical_optimizer import solve_optimal_defense, OptimizeDefenseRequest


async def run_optimizer_test():
    print("--- 1. Loading Golden Highlight 2 (Min 35:42) ---")
    frames = loader.fetch_match_360_frames(3869685)
    frame_data = frames[1]  # Highlight 2 (Min 35:42)
    frame = MatchFramePayload(**frame_data)
    print(f"Loaded event {frame.event_uuid} with {len(frame.players)} players.")
    print(f"Original xT: {frame.metrics.original_xt:.3f}, Pass Prob: {frame.metrics.pass_completion_prob:.1f}%")

    print("\n--- 2. Executing Spatial Defensive Optimization ---")
    req = OptimizeDefenseRequest(frame=frame, max_defenders_to_move=2, max_radius_meters=5.8)
    
    start_t = time.perf_counter()
    response = await solve_optimal_defense(req)
    total_t = (time.perf_counter() - start_t) * 1000

    print(f"Optimization completed in {response.compute_time_ms:.2f}ms (Total roundtrip: {total_t:.2f}ms)")
    print(f"Evaluated {response.evaluated_configurations} micro-configurations.")
    print(f"Total adjustments proposed: {len(response.adjustments)}")

    assert len(response.adjustments) > 0, "Optimizer should adjust at least one defender!"

    for adj in response.adjustments:
        print(f"  - [{adj.name}] ({adj.from_x}, {adj.from_y}) -> ({adj.to_x}, {adj.to_y}) | Disp: {adj.displacement_m}m")
        print(f"    Reason: {adj.tactical_reason}")
        assert adj.displacement_m <= 6.0, f"Displacement {adj.displacement_m}m exceeded 6.0m physical inertia limit!"

    print(f"\nOriginal Threat xT: {frame.metrics.original_xt:.3f}")
    print(f"Projected Threat xT: {response.projected_metrics.simulated_xt:.3f}")
    print(f"Projected Pass Completion: {response.projected_metrics.pass_completion_prob:.1f}%")
    print(f"Threat Delta: {response.projected_metrics.xt_delta:+.3f}")

    assert response.projected_metrics.simulated_xt <= frame.metrics.original_xt, (
        f"Optimized xT ({response.projected_metrics.simulated_xt}) must not increase original xT ({frame.metrics.original_xt})!"
    )

    print("\n✅ Auto-Coach Optimizer test passed successfully with 100% constraints satisfied!")


if __name__ == "__main__":
    asyncio.run(run_optimizer_test())
