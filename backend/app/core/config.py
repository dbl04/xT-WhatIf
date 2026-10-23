"""
Configuration settings for xT-WhatIf Backend.
Loads environment variables with robust defaults for local development.

Architecture Note on Caching:
Instead of an external network dependency like Redis, xT-WhatIf uses an in-process,
high-performance deterministic LRU cache (_simulation_cache in app.services.agent_swarm)
keyed by (event_uuid, sorted_modified_positions). This yields sub-1ms response times,
eliminates cold-start network roundtrips, and maintains total resilience during cloud outages.
"""

from typing import List, Optional
from pathlib import Path
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App General Settings
    APP_NAME: str = "xT-WhatIf Engine"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Public demo guardrails (see app/core/rate_limit.py)
    RATE_LIMIT_ENABLED: bool = True
    # Chaos mode is global state on a shared demo: it switches itself off after this long.
    CHAOS_AUTO_RESET_SECONDS: int = 90
    # Largest WebSocket message accepted, in bytes (a full 22-player frame is ~6 KB).
    WS_MAX_MESSAGE_BYTES: int = 64_000
    # Live game (app/services/live_match.py). Only ONE instance may run the match: set
    # LIVE_ENABLED=false on every other replica (and it never runs with SERVICE_ROLE=aks-worker).
    LIVE_ENABLED: bool = True
    LIVE_MATCH_DURATION_S: float = 300.0     # 90 game minutes in 5 real minutes
    LIVE_CHALLENGE_WINDOW_S: float = 30.0
    LIVE_MOMENT_COOLDOWN_S: float = 15.0     # after a reveal, and before the first moment
    LIVE_INTERMISSION_S: float = 30.0        # between the final whistle and the next kickoff
    LIVE_BOTS: int = 200                     # simulated fans on the leaderboard
    LIVE_FIRST_SEED: int = 11
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        validation_alias=AliasChoices("BACKEND_CORS_ORIGINS", "CORS_ORIGINS")
    )

    # Cloud Architecture: Dual Runtime Role (ACA Gateway vs AKS Worker)
    SERVICE_ROLE: str = Field(default="standalone", validation_alias=AliasChoices("SERVICE_ROLE", "APP_ROLE"))
    AKS_WORKER_URL: Optional[str] = Field(default=None, validation_alias=AliasChoices("AKS_WORKER_URL", "WORKER_SERVICE_URL"))

    # Azure OpenAI (Agent Swarm)
    AZURE_OPENAI_API_KEY: str = Field(default="mock-key", validation_alias="AZURE_OPENAI_API_KEY")
    AZURE_OPENAI_ENDPOINT: str = Field(default="https://mock.openai.azure.com/", validation_alias="AZURE_OPENAI_ENDPOINT")
    AZURE_OPENAI_API_VERSION: str = "2024-10-21"
    AZURE_OPENAI_DEPLOYMENT_REASONING: str = Field(
        default="gpt-4o",
        validation_alias=AliasChoices("AZURE_OPENAI_DEPLOYMENT_GPT4O", "AZURE_OPENAI_DEPLOYMENT_REASONING")
    )
    AZURE_OPENAI_DEPLOYMENT_COACH: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("AZURE_OPENAI_DEPLOYMENT_MINI", "AZURE_OPENAI_DEPLOYMENT_COACH")
    )
    AZURE_OPENAI_TTS_DEPLOYMENT: str = Field(
        default="gpt-4o-mini-tts",
        validation_alias=AliasChoices("AZURE_OPENAI_TTS_DEPLOYMENT")
    )
    AZURE_OPENAI_TTS_API_VERSION: str = Field(
        default="2025-03-01-preview",
        validation_alias=AliasChoices("AZURE_OPENAI_TTS_API_VERSION")
    )

    # Synthetic match fixtures (see app/services/synthetic_generator.py)
    CACHE_DIR: str = str(Path(__file__).resolve().parent.parent / "data" / "cache")


    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
