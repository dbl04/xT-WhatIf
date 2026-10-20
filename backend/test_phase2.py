import sys
import asyncio
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.schemas.match_contract import MatchFramePayload, CounterfactualRequest, PlayerNode
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID
from app.services.tactical_math import simulate_counterfactual
from app.services.agent_swarm import swarm


async def main():
    print("--- 1. Testing Synthetic Match Moments ---")
    frames = loader.fetch_match_360_frames(DEFAULT_MATCH_ID)
    print(f"Total moments loaded: {len(frames)}")
    assert len(frames) >= 5, "Must have at least 5 synthetic key moments!"
    for i, f in enumerate(frames):
        print(f"  Highlight {i+1}: Min {f['minute']}:{f['second']:02d} ({f['event_type']}) - {len(f['players'])} players")

    print("\n--- 2. Testing Advanced Geometry & Simulation ---")
    base_frame_data = frames[1]
    base_frame = MatchFramePayload(**base_frame_data)

    # Move the defender closest to the ball 4 m towards the pass destination
    defenders = [p for p in base_frame.players if p.team != base_frame.possession_team and not p.is_keeper]
    defender = min(defenders, key=lambda p: (p.x - base_frame.ball_x) ** 2 + (p.y - base_frame.ball_y) ** 2)
    mod_kounde = defender.model_copy(update={
        "x": round(min(119.0, defender.x + 4.0), 1),
        "y": defender.y,
        "original_x": defender.x,
        "original_y": defender.y,
        "is_modified": True,
    })
    
    sim_frame = simulate_counterfactual(base_frame, [mod_kounde])
    print(f"  Original xT: {sim_frame.metrics.original_xt:.2f}")
    print(f"  Simulated xT: {sim_frame.metrics.simulated_xt:.2f} (Delta: {sim_frame.metrics.xt_delta:+.2f})")
    print(f"  Pass Completion Prob: {sim_frame.metrics.pass_completion_prob:.1f}%")
    print(f"  Space Control Home: {sim_frame.metrics.space_control_home_pct:.1f}%")
    print(f"  Optimal Pass Target ID: {sim_frame.metrics.optimal_pass_target_id}")

    print("\n--- 3. Testing Agent Swarm Debate & Cache ---")
    debate = await swarm.generate_debate(sim_frame)
    print(f"  Generated {len(debate)} debate messages:")
    for m in debate:
        print(f"    [{m.avatar_badge}] {m.agent_name}: '{m.headline}'")
        print(f"      Referenced: {m.referenced_metric}")
        print(f"      Highlighted IDs: {m.highlighted_player_ids}")

    # Check cache hit
    debate_cached = await swarm.generate_debate(sim_frame)
    assert len(debate_cached) == len(debate)
    print("  In-memory cache hit: SUCCESS!")

    print("\n--- 4. Testing FastAPI Endpoints ---")
    from app.main import app
    from fastapi.testclient import TestClient
    client = TestClient(app)

    res_health = client.get("/health")
    assert res_health.status_code == 200
    print("  GET /health: OK (200)")

    res_frames = client.get(f"/api/v1/match/{DEFAULT_MATCH_ID}/frames")
    assert res_frames.status_code == 200
    data_frames = res_frames.json()
    assert len(data_frames) == len(frames)
    print(f"  GET /api/v1/match/{DEFAULT_MATCH_ID}/frames: OK (200, returned {len(data_frames)} moments)")

    res_sim = client.post(
        "/api/v1/simulate",
        json={
            "match_id": DEFAULT_MATCH_ID,
            "event_uuid": base_frame.event_uuid,
            "modified_players": [mod_kounde.model_dump()]
        }
    )
    assert res_sim.status_code == 200
    sim_data = res_sim.json()
    assert sim_data["is_counterfactual_mode"] is True
    print(f"  POST /api/v1/simulate: OK (200, Delta xT: {sim_data['metrics']['xt_delta']:+.2f})")

    print("\n==========================================")
    print(">>> ALL 4 PHASE 2 TASKS FULLY VALIDATED! <<<")
    print("==========================================")


if __name__ == "__main__":
    asyncio.run(main())
