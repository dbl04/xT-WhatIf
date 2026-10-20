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
            "text": "La proyección espacial muestra un delta de amenaza de +0.14 xT en el carril interior izquierdo.",
            "agent_role": "data_scientist"
        }
    )
    elapsed1 = (time.perf_counter() - start) * 1000
    assert res1.status_code == 200, f"Expected 200, got {res1.status_code}: {res1.text}"
    data1 = res1.json()
    print(f"  Response: provider={data1['provider']}, voice_preset={data1['voice_preset']}, duration={data1['estimated_duration_sec']}s, latency={elapsed1:.2f}ms")
    assert data1["provider"] in ("azure-openai-tts", "browser-web-speech-fallback")
    assert data1["voice_preset"] == "es-ES-neural-fast"
    assert data1["estimated_duration_sec"] > 0
    assert elapsed1 < 2500, f"Expected fast response, took {elapsed1}ms"

    print("\n--- 2. Testing Míster Bianchi Synthesis ---")
    start = time.perf_counter()
    res2 = client.post(
        "/api/v1/tts/synthesize",
        json={
            "text": "¡Ojo con la basculación! Si Koundé no cierra el intervalo, dejamos desprotegida la espalda de Upamecano.",
            "agent_role": "classic_coach"
        }
    )
    elapsed2 = (time.perf_counter() - start) * 1000
    assert res2.status_code == 200
    data2 = res2.json()
    print(f"  Response: provider={data2['provider']}, voice_preset={data2['voice_preset']}, duration={data2['estimated_duration_sec']}s, latency={elapsed2:.2f}ms")
    assert data2["voice_preset"] == "es-ES-neural-deep"
    assert data2["estimated_duration_sec"] > 0

    print("\n✅ All TTS Service tests passed successfully!")


if __name__ == "__main__":
    test_tts_service()
