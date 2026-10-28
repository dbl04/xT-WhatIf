"""
Neural Text-To-Speech (TTS) Service for xT-WhatIf Dialectical Debate.
Providers, in order: Azure AI Speech neural voices (`AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`),
Azure OpenAI TTS (`gpt-4o-mini-tts` and `tts-1`), then the browser's Web Speech API.
Azure AI Speech comes first because it is available in every region the subscription may use,
while the OpenAI TTS models are only deployed in a few.
Provides dual vocal personas:
- Dr. Voronoi (AI-QUANT): Analytical, high-cadence, precise metric cadence (Ryan / Álvaro; OpenAI echo).
- Coach Bianchi (PRO-COACH): Deep, gritty pitch-side passion (Thomas / Darío; OpenAI alloy).
Speaks English or Spanish (personalisation: `language`); the audio-description audience is read slower.

Features (Persona 2):
1. Extended timeout (~7.0s, configurable via `AZURE_OPENAI_TTS_TIMEOUT_S` in 6–8s range) + sentence chunking support.
2. Uses `settings.AZURE_OPENAI_TTS_DEPLOYMENT` (default `gpt-4o-mini-tts`) and validates API version
   (`2025-03-01-preview` required for `gpt-4o-mini-tts`) and endpoint region compatibility.
3. Emits `logger.warning(...)` whenever synthesis falls back to `browser-web-speech-fallback` and
   returns `warning` / `fallback_warning` and `is_fallback=True` in `TTSResponse` for Persona 3 (Frontend).
"""

import re
import json
import base64
import logging
import asyncio
from collections import OrderedDict
from typing import Dict, List, Literal, Optional, Tuple
from xml.sax.saxutils import escape
import httpx
from pydantic import BaseModel, Field
from fastapi import APIRouter
from app.core.config import settings
from app.agents.what_if_nl import router as agents_router
from app.mcp.server import router as mcp_router

logger = logging.getLogger("xtwhatif.tts")

router = APIRouter(tags=["tts"])

# Default timeout raised from 2.0s to 7.0s (within the 6–8s target window)
DEFAULT_TTS_TIMEOUT_S: float = 7.0
MIN_GPT4O_TTS_API_VERSION: str = "2025-03-01-preview"
SUPPORTED_GPT4O_TTS_REGIONS = ("eastus2", "swedencentral", "northcentralus", "eastus", "westeurope")


class TTSRequest(BaseModel):
    # Paid Azure TTS call: cap the length (a debate turn is ~400 characters).
    text: str = Field(..., min_length=1, max_length=1200)
    agent_role: Literal["data_scientist", "classic_coach"]
    language: Literal["en", "es"] = "en"
    audience: Literal["casual", "analyst", "coach", "audio_description"] = "analyst"
    synthesize_by_sentence: bool = False


class TTSResponse(BaseModel):
    audio_base64: Optional[str] = None
    provider: Literal["azure-ai-speech", "azure-openai-tts", "browser-web-speech-fallback"]
    voice_preset: str
    estimated_duration_sec: float
    is_fallback: bool = False
    warning: Optional[str] = None
    fallback_warning: Optional[str] = None
    deployment: Optional[str] = None


# Spoken style per language and role for models that accept instructions (gpt-4o-mini-tts).
_TTS_INSTRUCTIONS: Dict[str, str] = {
    "en": "Speak as a British football TV pundit: clear, lively, natural pace.",
    "es": "Habla como un comentarista de fútbol de la televisión española: claro, vivo, con acento de España.",
}
_ROLE_INSTRUCTIONS: Dict[Tuple[str, str], str] = {
    ("en", "data_scientist"): (
        "Speak as a British football data analyst TV pundit (Dr. Voronoi): crisp, analytical, confident pace."
    ),
    ("en", "classic_coach"): (
        "Speak as a veteran football manager pitch-side pundit (Coach Bianchi): warm, passionate, authoritative."
    ),
    ("es", "data_scientist"): (
        "Habla como un analista de datos de fútbol en televisión española (Dr. Voronoi): claro, preciso, ritmo ágil."
    ),
    ("es", "classic_coach"): (
        "Habla como un entrenador clásico de fútbol en televisión española (Míster Bianchi): apasionado, táctico, firme."
    ),
}
_AUDIO_DESCRIPTION_SPEED = 0.9

# Azure AI Speech neural voice, speaking rate and pitch per (language, role): Voronoi brisk and
# bright, Bianchi slower and deeper, so the two pundits are told apart by ear.
_SPEECH_VOICES: Dict[Tuple[str, str], str] = {
    ("en", "data_scientist"): "en-GB-RyanNeural",
    ("en", "classic_coach"): "en-GB-ThomasNeural",
    ("es", "data_scientist"): "es-ES-AlvaroNeural",
    ("es", "classic_coach"): "es-ES-DarioNeural",
}
_SPEECH_PROSODY: Dict[str, Tuple[float, str]] = {
    "data_scientist": (1.06, "+2%"),
    "classic_coach": (0.96, "-4%"),
}
_SPEECH_LOCALES = {"en": "en-GB", "es": "es-ES"}
_SPEECH_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"


def _voice_preset(language: str, role: str) -> str:
    locale = "en-GB" if language == "en" else "es-ES"
    return f"{locale}-neural-{'fast' if role == 'data_scientist' else 'deep'}"


def _estimate_duration(text: str, role: str, audience: str = "analyst") -> float:
    """Estimates speech duration based on word count and cadence."""
    words = len(text.split())
    # Dr. Voronoi speaks faster (~3.2 words/sec), Coach Bianchi pauses for emphasis (~2.6 words/sec)
    cadence = 3.2 if role == "data_scientist" else 2.6
    if audience == "audio_description":
        cadence *= _AUDIO_DESCRIPTION_SPEED
    return max(1.0, round(words / cadence, 2))


def split_into_sentences(text: str) -> List[str]:
    """Splits a paragraph into individual sentences for chunked low-latency TTS synthesis."""
    parts = [s.strip() for s in re.split(r"(?<=[.!?¡¿])\s+", text.strip()) if s.strip()]
    return parts if parts else [text.strip()]


def resolve_tts_api_version(
    deployment: str,
    general_api_version: Optional[str] = None,
    tts_api_version: Optional[str] = None,
) -> str:
    """
    Checks API version compatibility for Azure OpenAI TTS deployments:
    - `gpt-4o-mini-tts` requires API version >= `2025-03-01-preview` on Azure OpenAI.
    - `tts-1` / `tts-1-hd` work with `2024-10-21` or newer.
    """
    gen_ver = general_api_version or getattr(settings, "AZURE_OPENAI_API_VERSION", "2024-10-21")
    tts_ver = tts_api_version or getattr(settings, "AZURE_OPENAI_TTS_API_VERSION", MIN_GPT4O_TTS_API_VERSION)
    if "gpt-4o" in (deployment or "").lower():
        if gen_ver < "2025-01-01":
            return tts_ver
        return gen_ver
    return gen_ver


def check_tts_endpoint_compatibility(endpoint: str, deployment: str, api_version: str) -> Optional[str]:
    """
    Checks Azure OpenAI endpoint and API version for known `gpt-4o-mini-tts` regional/version notes.
    Returns an advisory diagnostic string if a potential mismatch is detected, or None.
    """
    ep_lower = (endpoint or "").lower()
    if "gpt-4o" in (deployment or "").lower() and api_version < "2025-01-01":
        return (
            f"Deployment '{deployment}' requires api_version >= {MIN_GPT4O_TTS_API_VERSION} "
            f"(got '{api_version}')."
        )
    # Check if region is explicitly embedded in hostname and not in primary TTS regions
    for known_unsupported in ("francecentral", "japaneast", "brazilsouth", "australiaeast"):
        if known_unsupported in ep_lower and "gpt-4o" in (deployment or "").lower():
            return (
                f"Endpoint region '{known_unsupported}' may not support '{deployment}'; "
                f"recommended regions: {', '.join(SUPPORTED_GPT4O_TTS_REGIONS[:3])}."
            )
    return None


async def _call_azure_speech(
    client,
    deployment: str,
    voice: str,
    text: str,
    options: dict,
    timeout_s: float,
) -> bytes:
    """Executes a single Azure OpenAI speech synthesis call with graceful kwarg fallback."""
    try:
        response = await asyncio.wait_for(
            client.audio.speech.create(
                model=deployment,
                voice=voice,
                input=text,
                response_format="mp3",
                **options,
            ),
            timeout=timeout_s,
        )
    except TypeError:
        # Older openai SDKs may not accept `instructions` directly; pass via extra_body or strip
        clean_opts = {k: v for k, v in options.items() if k != "instructions"}
        if "instructions" in options:
            clean_opts["extra_body"] = {"instructions": options["instructions"]}
        try:
            response = await asyncio.wait_for(
                client.audio.speech.create(
                    model=deployment,
                    voice=voice,
                    input=text,
                    response_format="mp3",
                    **clean_opts,
                ),
                timeout=timeout_s,
            )
        except TypeError:
            clean_opts.pop("extra_body", None)
            response = await asyncio.wait_for(
                client.audio.speech.create(
                    model=deployment,
                    voice=voice,
                    input=text,
                    response_format="mp3",
                    **clean_opts,
                ),
                timeout=timeout_s,
            )

    raw_audio = await response.aread() if hasattr(response, "aread") else response.content
    return raw_audio


def speech_configured() -> bool:
    """True when an Azure AI Speech key is set."""
    key = (getattr(settings, "AZURE_SPEECH_KEY", "") or "").strip()
    return bool(key) and key not in ("mock-key", "disabled", "your-azure-speech-key-here")


def openai_tts_configured() -> bool:
    """True when real Azure OpenAI credentials are set (not the mock defaults)."""
    return (
        bool(settings.AZURE_OPENAI_API_KEY)
        and settings.AZURE_OPENAI_API_KEY
        not in ("mock-key", "", "your-azure-openai-key-here", "mock-azure-openai-key")
        and bool(settings.AZURE_OPENAI_ENDPOINT)
        and "mock.openai.azure.com" not in settings.AZURE_OPENAI_ENDPOINT
    )


def azure_tts_configured() -> bool:
    """True when any Azure voice (AI Speech or OpenAI TTS) can be tried before the browser's."""
    return speech_configured() or openai_tts_configured()


def _speech_rate(role: str, audience: str) -> str:
    rate = _SPEECH_PROSODY[role][0] * (_AUDIO_DESCRIPTION_SPEED if audience == "audio_description" else 1.0)
    return f"{round((rate - 1) * 100):+d}%"


def build_ssml(text: str, role: str, language: str, audience: str) -> str:
    """SSML for one pundit line: their neural voice, pace and pitch; the text is XML-escaped."""
    voice = _SPEECH_VOICES[(language, role)]
    pitch = _SPEECH_PROSODY[role][1]
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{_SPEECH_LOCALES[language]}">'
        f'<voice name="{voice}"><prosody rate="{_speech_rate(role, audience)}" pitch="{pitch}">'
        f"{escape(text)}</prosody></voice></speak>"
    )


async def _call_azure_ai_speech(request: TTSRequest, timeout_s: float) -> bytes:
    """One Azure AI Speech REST call (text to speech), returning MP3 bytes."""
    region = (getattr(settings, "AZURE_SPEECH_REGION", "") or "francecentral").strip()
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": _SPEECH_OUTPUT_FORMAT,
                "User-Agent": "xt-whatif",
            },
            content=build_ssml(request.text, request.agent_role, request.language, request.audience).encode("utf-8"),
        )
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
    if not response.content:
        raise RuntimeError("empty audio")
    return response.content


# Synthesised audio by (text, role, language, slow, by_sentence): fixed phrases and replayed
# debates are paid for once per replica. LRU, base64 MP3 of a few tens of KB each, with the
# provider and voice/deployment that produced it.
_AUDIO_CACHE_SIZE = 128
_AUDIO_CACHE: "OrderedDict[Tuple[str, str, str, bool, bool], Tuple[str, str, str]]" = OrderedDict()


def _remember(cache_key, b64_audio: str, provider: str, source: str) -> None:
    _AUDIO_CACHE[cache_key] = (b64_audio, provider, source)
    while len(_AUDIO_CACHE) > _AUDIO_CACHE_SIZE:
        _AUDIO_CACHE.popitem(last=False)


@router.post("/api/v1/tts/synthesize", response_model=TTSResponse)
async def synthesize_speech(request: TTSRequest) -> TTSResponse:
    """
    Synthesizes speech for an agent message.
    Tries Azure AI Speech, then Azure OpenAI TTS (`AZURE_OPENAI_TTS_DEPLOYMENT`, default
    `gpt-4o-mini-tts`, ~7.0s timeout or sentence-by-sentence synthesis); logs a warning and returns
    `warning` / `fallback_warning` in the response when falling back to `browser-web-speech-fallback`.
    """
    role = request.agent_role
    voice = "echo" if role == "data_scientist" else "alloy"
    voice_preset = _voice_preset(request.language, role)
    estimated_dur = _estimate_duration(request.text, role, request.audience)
    deployment = getattr(settings, "AZURE_OPENAI_TTS_DEPLOYMENT", None) or "gpt-4o-mini-tts"
    timeout_s = float(getattr(settings, "AZURE_OPENAI_TTS_TIMEOUT_S", DEFAULT_TTS_TIMEOUT_S) or DEFAULT_TTS_TIMEOUT_S)

    cache_key = (request.text, role, request.language, request.audience == "audio_description",
                 request.synthesize_by_sentence)
    cached = _AUDIO_CACHE.get(cache_key)
    if cached is not None:
        _AUDIO_CACHE.move_to_end(cache_key)
        audio, provider, source = cached
        return TTSResponse(
            audio_base64=audio,
            provider=provider,
            voice_preset=voice_preset,
            estimated_duration_sec=estimated_dur,
            is_fallback=False,
            deployment=source,
        )

    failures: List[str] = []

    if speech_configured():
        speech_voice = _SPEECH_VOICES[(request.language, role)]
        try:
            raw_audio = await asyncio.wait_for(_call_azure_ai_speech(request, timeout_s), timeout=timeout_s)
            b64_audio = base64.b64encode(raw_audio).decode("utf-8")
            _remember(cache_key, b64_audio, "azure-ai-speech", speech_voice)
            return TTSResponse(
                audio_base64=b64_audio,
                provider="azure-ai-speech",
                voice_preset=voice_preset,
                estimated_duration_sec=estimated_dur,
                is_fallback=False,
                deployment=speech_voice,
            )
        except Exception as e:
            note = f"Azure AI Speech ({speech_voice}, timeout={timeout_s}s) failed: {e}"
            logger.warning(note)
            failures.append(note)

    if openai_tts_configured():
        api_version = resolve_tts_api_version(deployment)
        compat_note = check_tts_endpoint_compatibility(
            settings.AZURE_OPENAI_ENDPOINT, deployment, api_version
        )
        if compat_note:
            logger.warning("Azure OpenAI TTS compatibility check: %s", compat_note)

        try:
            from openai import AsyncAzureOpenAI

            client = AsyncAzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=api_version,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            )
            options: dict = {}
            if "gpt-4o" in deployment.lower():
                options["instructions"] = _ROLE_INSTRUCTIONS.get(
                    (request.language, role),
                    _TTS_INSTRUCTIONS[request.language],
                )
            if request.audience == "audio_description":
                options["speed"] = _AUDIO_DESCRIPTION_SPEED

            if request.synthesize_by_sentence:
                sentences = split_into_sentences(request.text)
                per_sentence_timeout = max(3.0, timeout_s / max(1, len(sentences)))
                chunks = await asyncio.gather(
                    *[
                        _call_azure_speech(client, deployment, voice, s, options, per_sentence_timeout)
                        for s in sentences
                    ]
                )
                raw_audio = b"".join(chunks)
            else:
                raw_audio = await _call_azure_speech(
                    client, deployment, voice, request.text, options, timeout_s
                )

            b64_audio = base64.b64encode(raw_audio).decode("utf-8")
            _remember(cache_key, b64_audio, "azure-openai-tts", deployment)

            return TTSResponse(
                audio_base64=b64_audio,
                provider="azure-openai-tts",
                voice_preset=voice_preset,
                estimated_duration_sec=estimated_dur,
                is_fallback=False,
                warning=None,
                fallback_warning=None,
                deployment=deployment,
            )
        except Exception as e:
            note = f"Azure OpenAI TTS ({deployment}, api_version={api_version}, timeout={timeout_s}s) failed: {e}"
            logger.warning(note)
            failures.append(note)

    if failures:
        warn_msg = "; ".join(failures) + ". Falling back to browser Web Speech API."
    else:
        # Azure credentials not configured / mock mode -> log as warning and return fallback metadata for Persona 3
        warn_msg = (
            f"Azure TTS not configured (no Azure AI Speech key; Azure OpenAI deployment={deployment}). "
            "Using browser Web Speech API fallback."
        )
        logger.warning(warn_msg)
    return TTSResponse(
        audio_base64=None,
        provider="browser-web-speech-fallback",
        voice_preset=voice_preset,
        estimated_duration_sec=estimated_dur,
        is_fallback=True,
        warning=warn_msg,
        fallback_warning=warn_msg,
        deployment=deployment,
    )


# ==============================================================================
# Azure Speech-To-Text (STT) Service for Voice What-If (Key Moments Mode)
# ==============================================================================
# Providers, in order:
# 1. Azure AI Speech Fast Transcription REST API (`AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`)
#    with domain-specific Phrase List (synthetic player names + football tactical vocabulary).
# 2. Azure OpenAI Audio Transcriptions (`AZURE_OPENAI_STT_DEPLOYMENT`, default `whisper-1`)
#    with domain prompt conditioning.
# 3. Browser Web Speech API fallback (`browser-web-speech-fallback`).

DEFAULT_STT_TIMEOUT_S: float = 6.5

TACTICAL_PHRASE_LIST: Tuple[str, ...] = (
    "Dr. Voronoi",
    "Coach Bianchi",
    "Míster Bianchi",
    "Expected Threat",
    "xT",
    "half-space",
    "rest defense",
    "full-back",
    "centre-back",
    "holding midfielder",
    "lateral derecho",
    "lateral izquierdo",
    "mediocentro",
    "central",
    "extremo",
    "cierra por dentro",
    "sale a presionar",
    "adelanta la línea",
    "línea de pase",
)


class STTRequest(BaseModel):
    audio_base64: str = Field(..., min_length=8, max_length=6_000_000, description="Base64-encoded recorded audio blob")
    mime_type: str = Field(default="audio/webm", max_length=80)
    language: Literal["en", "es"] = "es"
    player_names: List[str] = Field(
        default_factory=list,
        max_length=30,
        description="Optional active player names on the pitch to inject into Azure Phrase List / Whisper prompt",
    )


class STTResponse(BaseModel):
    text: str = ""
    provider: Literal["azure-ai-speech", "azure-openai-whisper", "browser-web-speech-fallback"]
    language: Literal["en", "es"] = "es"
    is_fallback: bool = False
    warning: Optional[str] = None
    deployment: Optional[str] = None
    phrase_boost_count: int = 0


def build_stt_phrases(player_names: Optional[List[str]] = None) -> List[str]:
    """Combines active pitch player names with football tactical terms for Azure Phrase List boosting."""
    seen: set = set()
    phrases: List[str] = []
    for raw in list(player_names or []) + list(TACTICAL_PHRASE_LIST):
        clean = (raw or "").strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            phrases.append(clean)
    return phrases[:60]


def build_whisper_prompt(language: str, phrases: List[str]) -> str:
    """Builds a concise tactical prompt for Azure OpenAI Whisper to prevent misspelling player names."""
    joined = ", ".join(phrases[:35])
    if language == "es":
        return f"Orden táctica de fútbol (xT-WhatIf). Jugadores y términos clave: {joined}."
    return f"Football tactical command (xT-WhatIf). Players and key terms: {joined}."


def _audio_filename_for_mime(mime_type: str) -> Tuple[str, str]:
    m = (mime_type or "audio/webm").lower().split(";")[0].strip()
    if "wav" in m:
        return "voice_command.wav", "audio/wav"
    if "ogg" in m:
        return "voice_command.ogg", "audio/ogg"
    if "mp4" in m or "m4a" in m or "aac" in m:
        return "voice_command.m4a", "audio/mp4"
    if "mpeg" in m or "mp3" in m:
        return "voice_command.mp3", "audio/mpeg"
    return "voice_command.webm", "audio/webm"


async def _call_azure_ai_speech_stt(
    audio_bytes: bytes,
    mime_type: str,
    language: str,
    phrases: List[str],
    timeout_s: float,
) -> str:
    """
    Calls Azure AI Speech Fast Transcription REST API with a domain-specific Phrase List,
    and falls back to the classic Short-Audio STT REST endpoint if needed.
    """
    region = (getattr(settings, "AZURE_SPEECH_REGION", "") or "francecentral").strip()
    locale = _SPEECH_LOCALES.get(language, "es-ES")
    filename, clean_mime = _audio_filename_for_mime(mime_type)

    definition = {
        "locales": [locale],
        "phraseList": {"phrases": phrases},
    }
    fast_url = (
        f"https://{region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe"
        "?api-version=2024-11-15"
    )

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(
            fast_url,
            headers={
                "Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY,
                "User-Agent": "xt-whatif",
            },
            files={
                "audio": (filename, audio_bytes, clean_mime),
                "definition": (None, json.dumps(definition), "application/json"),
            },
        )
        if response.status_code == 200:
            payload = response.json()
            combined = payload.get("combinedPhrases") or []
            if combined and isinstance(combined[0], dict) and combined[0].get("text"):
                return str(combined[0]["text"]).strip()
            phrases_out = payload.get("phrases") or []
            text = " ".join(str(p.get("text", "")).strip() for p in phrases_out if isinstance(p, dict)).strip()
            if text:
                return text

        # Fallback to Azure AI Speech Short-Audio Recognition v1 REST endpoint (for WAV/OGG streams)
        short_url = (
            f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
            f"?language={locale}&format=detailed"
        )
        short_resp = await client.post(
            short_url,
            headers={
                "Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY,
                "Content-Type": clean_mime,
                "Accept": "application/json",
                "User-Agent": "xt-whatif",
            },
            content=audio_bytes,
        )
        if short_resp.status_code == 200:
            short_data = short_resp.json()
            display = (short_data.get("DisplayText") or "").strip()
            if display:
                return display
            nbest = short_data.get("NBest") or []
            if nbest and isinstance(nbest[0], dict) and nbest[0].get("Display"):
                return str(nbest[0]["Display"]).strip()

        raise RuntimeError(
            f"Azure AI Speech STT HTTP {response.status_code}: {response.text[:180]}"
        )


async def _call_azure_openai_whisper(
    audio_bytes: bytes,
    mime_type: str,
    language: str,
    phrases: List[str],
    deployment: str,
    timeout_s: float,
) -> str:
    """Calls Azure OpenAI Audio Transcriptions (`whisper-1` or `gpt-4o-mini-transcribe`)."""
    from openai import AsyncAzureOpenAI

    api_version = getattr(settings, "AZURE_OPENAI_API_VERSION", "2024-10-21")
    client = AsyncAzureOpenAI(
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version=api_version,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
    )
    filename, clean_mime = _audio_filename_for_mime(mime_type)
    prompt = build_whisper_prompt(language, phrases)

    transcription = await asyncio.wait_for(
        client.audio.transcriptions.create(
            model=deployment,
            file=(filename, audio_bytes, clean_mime),
            language=language,
            prompt=prompt,
        ),
        timeout=timeout_s,
    )
    text = getattr(transcription, "text", None)
    if text is None and isinstance(transcription, dict):
        text = transcription.get("text")
    cleaned = str(text or "").strip()
    if not cleaned:
        raise RuntimeError("Empty transcription from Azure OpenAI Whisper")
    return cleaned


@router.post("/api/v1/speech/transcribe", response_model=STTResponse, tags=["tts"])
async def transcribe_speech(request: STTRequest) -> STTResponse:
    """
    Transcribes a recorded tactical voice command using Azure Cognitive Services:
    1. Tries Azure AI Speech Fast Transcription REST API (`AZURE_SPEECH_KEY`) with custom Phrase List.
    2. Tries Azure OpenAI Whisper (`AZURE_OPENAI_STT_DEPLOYMENT`, default `whisper-1`) with tactical prompt.
    3. Returns `browser-web-speech-fallback` metadata if neither cloud provider is configured or reachable.
    """
    phrases = build_stt_phrases(request.player_names)
    deployment = getattr(settings, "AZURE_OPENAI_STT_DEPLOYMENT", None) or "whisper-1"
    timeout_s = float(getattr(settings, "AZURE_OPENAI_STT_TIMEOUT_S", DEFAULT_STT_TIMEOUT_S) or DEFAULT_STT_TIMEOUT_S)

    try:
        raw_b64 = request.audio_base64.split(",")[-1].strip()
        audio_bytes = base64.b64decode(raw_b64)
        if not audio_bytes:
            raise ValueError("decoded audio is empty")
    except Exception as exc:
        warn = f"Invalid base64 audio payload: {exc}. Falling back to browser Web Speech API."
        logger.warning(warn)
        return STTResponse(
            text="",
            provider="browser-web-speech-fallback",
            language=request.language,
            is_fallback=True,
            warning=warn,
            deployment=deployment,
            phrase_boost_count=len(phrases),
        )

    failures: List[str] = []

    if speech_configured():
        region = (getattr(settings, "AZURE_SPEECH_REGION", "") or "francecentral").strip()
        try:
            text = await asyncio.wait_for(
                _call_azure_ai_speech_stt(audio_bytes, request.mime_type, request.language, phrases, timeout_s),
                timeout=timeout_s + 0.5,
            )
            return STTResponse(
                text=text,
                provider="azure-ai-speech",
                language=request.language,
                is_fallback=False,
                warning=None,
                deployment=f"azure-speech-stt-{region}",
                phrase_boost_count=len(phrases),
            )
        except Exception as e:
            note = f"Azure AI Speech STT ({region}, timeout={timeout_s}s) failed: {e}"
            logger.warning(note)
            failures.append(note)

    if openai_tts_configured():
        try:
            text = await _call_azure_openai_whisper(
                audio_bytes, request.mime_type, request.language, phrases, deployment, timeout_s
            )
            return STTResponse(
                text=text,
                provider="azure-openai-whisper",
                language=request.language,
                is_fallback=False,
                warning=None,
                deployment=deployment,
                phrase_boost_count=len(phrases),
            )
        except Exception as e:
            note = f"Azure OpenAI Whisper ({deployment}, timeout={timeout_s}s) failed: {e}"
            logger.warning(note)
            failures.append(note)

    if failures:
        warn_msg = "; ".join(failures) + ". Falling back to browser Web Speech API."
    else:
        warn_msg = (
            f"Azure STT not configured (no Azure AI Speech key; Azure OpenAI deployment={deployment}). "
            "Using browser Web Speech API fallback."
        )
        logger.warning(warn_msg)

    return STTResponse(
        text="",
        provider="browser-web-speech-fallback",
        language=request.language,
        is_fallback=True,
        warning=warn_msg,
        deployment=deployment,
        phrase_boost_count=len(phrases),
    )


# Mount the Multi-Agent What-If and MCP Server routers so FastAPI serves them seamlessly
router.include_router(agents_router)
router.include_router(mcp_router)
