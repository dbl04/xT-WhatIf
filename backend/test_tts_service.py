"""
Test Suite for Dual-Voice Neural TTS Service (Persona 2).
Validates:
1. Synthesis endpoint for both roles (Dr. Voronoi & Coach Bianchi) in EN and ES.
2. Timeout raised to ~6–8s (`DEFAULT_TTS_TIMEOUT_S == 7.0`, `settings.AZURE_OPENAI_TTS_TIMEOUT_S`).
3. `AZURE_OPENAI_TTS_DEPLOYMENT` in `config.py` and `.env.example` (default `gpt-4o-mini-tts`).
4. API version (`2025-03-01-preview` for `gpt-4o-mini-tts`) and region compatibility checks.
5. `logger.warning` emitted and `warning` / `fallback_warning` + `is_fallback=True` returned in response
   when falling back to Browser Web Speech API so Persona 3 can display it.
6. Mocked `gpt-4o-mini-tts` synthesis (single-shot and sentence-by-sentence).
"""

import sys
import time
import base64
import httpx
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.config import settings
from app.services.tts_service import (
    DEFAULT_TTS_TIMEOUT_S,
    MIN_GPT4O_TTS_API_VERSION,
    TTSRequest,
    TTSResponse,
    _AUDIO_CACHE,
    build_ssml,
    check_tts_endpoint_compatibility,
    resolve_tts_api_version,
    router,
    split_into_sentences,
)


def test_tts_service():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    print("--- 1. Checking TTS Config & Timeout (6-8s window) ---")
    assert 6.0 <= DEFAULT_TTS_TIMEOUT_S <= 8.0
    assert 6.0 <= settings.AZURE_OPENAI_TTS_TIMEOUT_S <= 8.0
    assert hasattr(settings, "AZURE_OPENAI_TTS_DEPLOYMENT")
    assert settings.AZURE_OPENAI_TTS_DEPLOYMENT == "gpt-4o-mini-tts"
    assert resolve_tts_api_version("gpt-4o-mini-tts", "2024-10-21") == MIN_GPT4O_TTS_API_VERSION
    assert resolve_tts_api_version("tts-1", "2024-10-21") == "2024-10-21"
    assert check_tts_endpoint_compatibility("https://res.eastus2.openai.azure.com/", "gpt-4o-mini-tts", "2025-03-01-preview") is None
    assert check_tts_endpoint_compatibility("https://res.francecentral.openai.azure.com/", "gpt-4o-mini-tts", "2025-03-01-preview") is not None

    print("--- 2. Testing Dr. Voronoi Synthesis & Browser Fallback Warning ---")
    start = time.perf_counter()
    with patch("app.services.tts_service.logger.warning") as mock_warn:
        res1 = client.post(
            "/api/v1/tts/synthesize",
            json={
                "text": "The spatial projection shows a threat delta of +0.14 xT in the left half-space.",
                "agent_role": "data_scientist",
            },
        )
        elapsed1 = (time.perf_counter() - start) * 1000
        assert res1.status_code == 200, f"Expected 200, got {res1.status_code}: {res1.text}"
        data1 = res1.json()
        print(
            f"  Response: provider={data1['provider']}, voice_preset={data1['voice_preset']}, "
            f"duration={data1['estimated_duration_sec']}s, is_fallback={data1['is_fallback']}, latency={elapsed1:.2f}ms"
        )
        assert data1["provider"] in ("azure-openai-tts", "browser-web-speech-fallback")
        assert data1["voice_preset"] == "en-GB-neural-fast"
        assert data1["estimated_duration_sec"] > 0
        if data1["provider"] == "browser-web-speech-fallback":
            assert data1["is_fallback"] is True
            assert data1["warning"] is not None and len(data1["warning"]) > 0
            assert data1["fallback_warning"] == data1["warning"]
            assert mock_warn.called, "Expected logger.warning to be called when falling back to browser voice"

    print("\n--- 3. Testing Coach Bianchi Synthesis (Spanish, audio description) ---")
    res2 = client.post(
        "/api/v1/tts/synthesize",
        json={
            "text": "¡Ojo con la basculación! Si el central no cierra el intervalo, dejamos desprotegida la espalda del lateral.",
            "agent_role": "classic_coach",
            "language": "es",
            "audience": "audio_description",
        },
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["voice_preset"] == "es-ES-neural-deep"
    assert data2["estimated_duration_sec"] > 0

    print("\n--- 4. Testing gpt-4o-mini-tts Synthesis (Mocked Azure OpenAI Speech API) ---")
    fake_mp3 = b"ID3-FAKE-GPT4O-MINI-TTS-MP3-AUDIO"
    mock_speech_resp = MagicMock()
    mock_speech_resp.content = fake_mp3
    mock_speech_resp.aread = AsyncMock(return_value=fake_mp3)

    mock_azure_client = MagicMock()
    mock_azure_client.audio.speech.create = AsyncMock(return_value=mock_speech_resp)

    with (
        patch.object(settings, "AZURE_OPENAI_API_KEY", "real-test-key-123"),
        patch.object(settings, "AZURE_OPENAI_ENDPOINT", "https://xtwhatif-eastus2.openai.azure.com/"),
        patch.object(settings, "AZURE_OPENAI_TTS_DEPLOYMENT", "gpt-4o-mini-tts"),
        patch("openai.AsyncAzureOpenAI", return_value=mock_azure_client),
    ):
        res_azure = client.post(
            "/api/v1/tts/synthesize",
            json={
                "text": "Primera frase táctica. Segunda frase con métricas verificadas.",
                "agent_role": "data_scientist",
                "language": "es",
                "audience": "analyst",
                "synthesize_by_sentence": True,
            },
        )
        assert res_azure.status_code == 200
        azure_data = res_azure.json()
        assert azure_data["provider"] == "azure-openai-tts"
        assert azure_data["is_fallback"] is False
        assert azure_data["warning"] is None
        assert azure_data["deployment"] == "gpt-4o-mini-tts"
        decoded = base64.b64decode(azure_data["audio_base64"])
        assert decoded == fake_mp3 + fake_mp3  # 2 sentences concatenated

    print("\n--- 5. Unsupported language is rejected ---")
    res3 = client.post(
        "/api/v1/tts/synthesize",
        json={"text": "Bonjour", "agent_role": "classic_coach", "language": "fr"},
    )
    assert res3.status_code == 422

    print("\n--- 6. Azure AI Speech is tried first (mocked REST endpoint) ---")
    _AUDIO_CACHE.clear()
    fake_speech_mp3 = b"ID3-FAKE-AZURE-AI-SPEECH-MP3"
    seen = []

    def speech_handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, content=fake_speech_mp3)

    real_async_client = httpx.AsyncClient
    with (
        patch.object(settings, "AZURE_SPEECH_KEY", "speech-test-key"),
        patch.object(settings, "AZURE_SPEECH_REGION", "francecentral"),
        patch.object(settings, "AZURE_OPENAI_API_KEY", "mock-key"),
        patch(
            "app.services.tts_service.httpx.AsyncClient",
            side_effect=lambda **kw: real_async_client(transport=httpx.MockTransport(speech_handler), **kw),
        ),
    ):
        res_speech = client.post(
            "/api/v1/tts/synthesize",
            json={"text": "Gap between the <centre-backs> & the full-back.", "agent_role": "data_scientist",
                  "language": "en"},
        )
        data_speech = res_speech.json()
        assert data_speech["provider"] == "azure-ai-speech", data_speech
        assert data_speech["deployment"] == "en-GB-RyanNeural"
        assert base64.b64decode(data_speech["audio_base64"]) == fake_speech_mp3
        req = seen[0]
        assert str(req.url) == "https://francecentral.tts.speech.microsoft.com/cognitiveservices/v1"
        assert req.headers["Ocp-Apim-Subscription-Key"] == "speech-test-key"
        assert req.headers["X-Microsoft-OutputFormat"] == "audio-24khz-48kbitrate-mono-mp3"
        body = req.content.decode("utf-8")
        assert "&lt;centre-backs&gt; &amp; the full-back" in body  # text is XML-escaped
        # Same line again: served from the cache, no second call.
        client.post("/api/v1/tts/synthesize", json={"text": "Gap between the <centre-backs> & the full-back.",
                                                    "agent_role": "data_scientist", "language": "en"})
        assert len(seen) == 1

    ssml = build_ssml("Hola", "classic_coach", "es", "audio_description")
    assert 'name="es-ES-DarioNeural"' in ssml and 'xml:lang="es-ES"' in ssml
    assert 'rate="-14%"' in ssml and 'pitch="-4%"' in ssml  # 0.96 x 0.9 for audio description

    print("\n--- 7. Speech failure falls through to Azure OpenAI, then to the browser ---")
    _AUDIO_CACHE.clear()
    with (
        patch.object(settings, "AZURE_SPEECH_KEY", "speech-test-key"),
        patch.object(settings, "AZURE_OPENAI_API_KEY", "real-test-key-123"),
        patch.object(settings, "AZURE_OPENAI_ENDPOINT", "https://xtwhatif-eastus2.openai.azure.com/"),
        patch("app.services.tts_service._call_azure_ai_speech", AsyncMock(side_effect=RuntimeError("HTTP 401"))),
        patch("openai.AsyncAzureOpenAI", return_value=mock_azure_client),
    ):
        data_fall = client.post("/api/v1/tts/synthesize",
                                json={"text": "Fall through.", "agent_role": "classic_coach"}).json()
        assert data_fall["provider"] == "azure-openai-tts", data_fall
    _AUDIO_CACHE.clear()
    with (
        patch.object(settings, "AZURE_SPEECH_KEY", "speech-test-key"),
        patch.object(settings, "AZURE_OPENAI_API_KEY", "mock-azure-openai-key"),  # CI placeholder: not real
        patch("app.services.tts_service._call_azure_ai_speech", AsyncMock(side_effect=RuntimeError("HTTP 401"))),
    ):
        data_none = client.post("/api/v1/tts/synthesize",
                                json={"text": "Nobody answers.", "agent_role": "classic_coach"}).json()
        assert data_none["provider"] == "browser-web-speech-fallback"
        assert "Azure AI Speech" in data_none["warning"] and "HTTP 401" in data_none["warning"]

    print("\n✅ All TTS Service tests passed successfully!")


if __name__ == "__main__":
    test_tts_service()
