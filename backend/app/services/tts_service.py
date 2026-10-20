"""
Neural Text-To-Speech (TTS) Service for xT-WhatIf Dialectical Debate.
Supports Azure OpenAI TTS with seamless instant fallback to Browser Web Speech API.
Provides dual vocal personas:
- Dr. Voronoi (AI-QUANT): Analytical, high-cadence, precise metric cadence (echo/onyx).
- Míster Bianchi (PRO-COACH): Deep, gritty pitch-side passion (alloy/fable).
"""

import os
import base64
import logging
import asyncio
from typing import Optional, Literal
from pydantic import BaseModel
from fastapi import APIRouter
from app.core.config import settings

logger = logging.getLogger("xtwhatif.tts")

router = APIRouter(prefix="/api/v1/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str
    agent_role: Literal["data_scientist", "classic_coach"]


class TTSResponse(BaseModel):
    audio_base64: Optional[str] = None
    provider: Literal["azure-openai-tts", "browser-web-speech-fallback"]
    voice_preset: str
    estimated_duration_sec: float


def _estimate_duration(text: str, role: str) -> float:
    """Estimates speech duration based on word count and cadence."""
    words = len(text.split())
    # Dr. Voronoi speaks faster (~3.2 words/sec), Míster Bianchi pauses for emphasis (~2.6 words/sec)
    cadence = 3.2 if role == "data_scientist" else 2.6
    return max(1.0, round(words / cadence, 2))


@router.post("/synthesize", response_model=TTSResponse)
async def synthesize_speech(request: TTSRequest) -> TTSResponse:
    """
    Synthesizes speech for an agent message.
    Tries Azure OpenAI TTS with a strict 2.0s timeout; gracefully falls back to browser-web-speech-fallback.
    """
    role = request.agent_role
    voice = "echo" if role == "data_scientist" else "alloy"
    voice_preset = "es-ES-neural-fast" if role == "data_scientist" else "es-ES-neural-deep"
    estimated_dur = _estimate_duration(request.text, role)

    # Check Azure OpenAI configuration
    has_azure = (
        bool(settings.AZURE_OPENAI_API_KEY)
        and settings.AZURE_OPENAI_API_KEY not in ("mock-key", "", "your-azure-openai-key-here")
        and bool(settings.AZURE_OPENAI_ENDPOINT)
        and "mock.openai.azure.com" not in settings.AZURE_OPENAI_ENDPOINT
    )

    if has_azure:
        try:
            from openai import AsyncAzureOpenAI
            client = AsyncAzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT
            )
            deployment = getattr(settings, "AZURE_OPENAI_TTS_DEPLOYMENT", None) or "tts-1"
            
            # 2.0s strict timeout
            response = await asyncio.wait_for(
                client.audio.speech.create(
                    model=deployment,
                    voice=voice,
                    input=request.text,
                    response_format="mp3"
                ),
                timeout=2.0
            )
            raw_audio = await response.aread() if hasattr(response, "aread") else response.content
            b64_audio = base64.b64encode(raw_audio).decode("utf-8")

            return TTSResponse(
                audio_base64=b64_audio,
                provider="azure-openai-tts",
                voice_preset=voice_preset,
                estimated_duration_sec=estimated_dur
            )
        except Exception as e:
            logger.info(f"Azure OpenAI TTS synthesis failed ({e}). Returning browser fallback.")

    # Resilient zero-downtime fallback
    return TTSResponse(
        audio_base64=None,
        provider="browser-web-speech-fallback",
        voice_preset=voice_preset,
        estimated_duration_sec=estimated_dur
    )
