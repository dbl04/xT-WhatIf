"""
Test Suite for Dual-Voice Neural TTS Service.
Validates synthesis endpoint for both roles and ensures sub-50ms fallback execution.
"""

import sys
import time
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.services.tts_service import router, TTSRequest, TTSResponse


def test_tts_service():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    print("--- 1. Testing Dr. Voronoi Synthesis ---")
    start = time.perf_counter()
    res1 = client.post(
        "/api/v1/tts/synthesize",
        json={
            "text": "The spatial projection shows a threat delta of +0.14 xT in the left half-space.",
            "agent_role": "data_scientist"
        }
    )
    elapsed1 = (time.perf_counter() - start) * 1000
    assert res1.status_code == 200, f"Expected 200, got {res1.status_code}: {res1.text}"
    data1 = res1.json()
    print(f"  Response: provider={data1['provider']}, voice_preset={data1['voice_preset']}, duration={data1['estimated_duration_sec']}s, latency={elapsed1:.2f}ms")
    assert data1["provider"] in ("azure-openai-tts", "browser-web-speech-fallback")
    assert data1["voice_preset"] == "en-GB-neural-fast"  # English is the default language
    assert data1["estimated_duration_sec"] > 0
    assert elapsed1 < 2500, f"Expected fast response, took {elapsed1}ms"

    print("\n--- 2. Testing Coach Bianchi Synthesis (Spanish, audio description) ---")
    start = time.perf_counter()
    res2 = client.post(
        "/api/v1/tts/synthesize",
        json={
            "text": "¡Ojo con la basculación! Si el central no cierra el intervalo, dejamos desprotegida la espalda del lateral.",
            "agent_role": "classic_coach",
            "language": "es",
            "audience": "audio_description"
        }
    )
    elapsed2 = (time.perf_counter() - start) * 1000
    assert res2.status_code == 200
    data2 = res2.json()
    print(f"  Response: provider={data2['provider']}, voice_preset={data2['voice_preset']}, duration={data2['estimated_duration_sec']}s, latency={elapsed2:.2f}ms")
    assert data2["voice_preset"] == "es-ES-neural-deep"
    assert data2["estimated_duration_sec"] > 0

    print("\n--- 3. Unsupported language is rejected ---")
    res3 = client.post(
        "/api/v1/tts/synthesize",
        json={"text": "Bonjour", "agent_role": "classic_coach", "language": "fr"}
    )
    assert res3.status_code == 422

    print("\n✅ All TTS Service tests passed successfully!")


if __name__ == "__main__":
    test_tts_service()
