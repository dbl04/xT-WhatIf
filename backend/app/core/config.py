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

    # Synthetic match fixtures (see app/services/synthetic_generator.py)
    CACHE_DIR: str = str(Path(__file__).resolve().parent.parent / "data" / "cache")


    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
