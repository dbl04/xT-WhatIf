"""
Configuration settings for PitchGhost-360 Backend.
Loads environment variables with robust defaults for local development.
"""

from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App General Settings
    APP_NAME: str = "xT-WhatIf Engine"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Azure OpenAI (Agent Swarm)
    AZURE_OPENAI_API_KEY: str = Field(default="mock-key", validation_alias="AZURE_OPENAI_API_KEY")
    AZURE_OPENAI_ENDPOINT: str = Field(default="https://mock.openai.azure.com/", validation_alias="AZURE_OPENAI_ENDPOINT")
    AZURE_OPENAI_API_VERSION: str = "2024-08-01-preview"
    AZURE_OPENAI_DEPLOYMENT_REASONING: str = "gpt-4o"
    AZURE_OPENAI_DEPLOYMENT_COACH: str = "gpt-4o-mini"

    # StatsBomb Open Data
    STATSBOMB_USER: str = ""
    STATSBOMB_PASSWORD: str = ""
    USE_STATSBOMB_OPEN_DATA: bool = True
    CACHE_DIR: str = "app/data/cache"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
