"""
xT-WhatIf FastAPI Entrypoint.
Provides REST and WebSocket endpoints for real-time StatsBomb 360 counterfactuals.
Enforces canonical 120x80 coordinate system and supports interactive multi-highlight simulation.
"""

import json
import logging
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.schemas.match_contract import (
    MatchFramePayload, CounterfactualRequest
)
from app.services.statsbomb_loader import loader
from app.services.tactical_math import simulate_counterfactual
from app.services.agent_swarm import swarm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("xtwhatif.main")

app = FastAPI(
    title="xT-WhatIf Engine",
    description="Interactive Counterfactual Engine Powered by Multi-Agent AI (StatsBomb 360)",
    version="2.0.0"
)

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "online",
        "service": "xT-WhatIf Engine",
        "version": "2.0.0",
        "coordinate_system": "StatsBomb 120x80 (X: 0.0-120.0, Y: 0.0-80.0)",
        "target_match": "3869685 (Argentina vs France - Final 2022)",
        "environment": settings.ENVIRONMENT
    }


@app.get("/api/v1/matches", tags=["Matches"])
async def get_available_matches():
    """Returns matches available in local 360 cache or Open Data."""
    return [
        {
            "match_id": 3869685,
            "title": "Argentina vs France",
            "competition": "FIFA World Cup Final 2022",
            "season": "2022",
            "highlights_count": 5,
            "has_360_frames": True
        }
    ]


@app.get("/api/v1/match/{match_id}/frames", response_model=List[MatchFramePayload], tags=["Matches"])
async def get_match_frames(match_id: int):
    """Returns curated Golden Highlights conforming strictly to MatchFramePayload."""
    raw_frames = loader.fetch_match_360_frames(match_id)
    if not raw_frames:
        raise HTTPException(status_code=404, detail="Match frames not found")
    return [MatchFramePayload(**f) for f in raw_frames]


@app.post("/api/v1/simulate", response_model=MatchFramePayload, tags=["Simulation"])
async def simulate_scenario(request: CounterfactualRequest):
    """
    Executes a counterfactual simulation:
    Applies modified player coordinates, recalculates xT & metrics, and triggers AI agent debate.
    """
    frames = loader.fetch_match_360_frames(request.match_id)
    base_dict = next((f for f in frames if f["event_uuid"] == request.event_uuid), frames[0])
    base_frame = MatchFramePayload(**base_dict)

    # 1. Recalculate metrics (Voronoi space control, Gaussian pass shadow, xT delta)
    simulated_frame = simulate_counterfactual(base_frame, request.modified_players)

    # 2. Trigger dialectical multi-agent debate swarm
    simulated_frame.agent_debate = await swarm.generate_debate(simulated_frame)

    return simulated_frame


# ---------------------------------------------------------------------------
# WebSocket Manager for Real-Time Streaming & Interactive Playback
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)


ws_manager = ConnectionManager()


@app.websocket("/ws/match/{match_id}")
@app.websocket("/match/{match_id}")
async def match_websocket_endpoint(websocket: WebSocket, match_id: int):
    """
    Real-time bidirectional WebSocket channel.
    Supports playback control, highlight seek, and instant counterfactual recalculations.
    """
    await ws_manager.connect(websocket)
    try:
        raw_frames = loader.fetch_match_360_frames(match_id)
        frames_list = [MatchFramePayload(**f) for f in raw_frames]
        current_frame_idx = 1 if len(frames_list) > 1 else 0  # Default to highlight 2 (Min 35:42)
        base_frame = frames_list[current_frame_idx]

        # Send initial frame upon handshake
        await websocket.send_json({
            "type": "INITIAL_FRAME",
            "frame_index": current_frame_idx,
            "total_frames": len(frames_list),
            "payload": base_frame.model_dump()
        })

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            action = message.get("action")
            msg_type = message.get("type")

            # 1. Seek / Navigate to a specific Golden Highlight frame
            if action == "seek" or msg_type == "SEEK_FRAME":
                target_idx = int(message.get("frame_index", 0))
                if 0 <= target_idx < len(frames_list):
                    current_frame_idx = target_idx
                    base_frame = frames_list[current_frame_idx]
                    await websocket.send_json({
                        "type": "FRAME_UPDATE",
                        "frame_index": current_frame_idx,
                        "payload": base_frame.model_dump()
                    })

            # 2. Playback transport state acknowledgment
            elif action in ("play", "pause"):
                await websocket.send_json({
                    "type": "PLAYBACK_STATE",
                    "action": action,
                    "speed": message.get("speed", 1.0)
                })

            # 3. Interactive Counterfactual Simulation
            elif action == "simulate" or msg_type == "SIMULATE_MOVE":
                payload_data = message.get("payload", {})
                request_data = CounterfactualRequest(**payload_data)

                # Match base frame by event_uuid
                matching_base = next(
                    (f for f in frames_list if f.event_uuid == request_data.event_uuid),
                    base_frame
                )

                # Recalculate geometry, pass lane and xT
                simulated_frame = simulate_counterfactual(matching_base, request_data.modified_players)
                # Generate AI agent debate
                simulated_frame.agent_debate = await swarm.generate_debate(simulated_frame)

                await websocket.send_json({
                    "type": "SIMULATION_UPDATE",
                    "frame_index": current_frame_idx,
                    "payload": simulated_frame.model_dump()
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.disconnect(websocket)
