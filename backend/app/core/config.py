from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_env: str = 'development'
    # Fixtures must be explicitly enabled. The product never shows fabricated
    # environmental observations by default.
    heatshield_use_fixtures: bool = False
    cors_origins: str = 'http://localhost:5173'
    database_path: str = 'heatshield.db'

    fortyguard_api_key: str | None = None
    fortyguard_base_url: str = 'https://api.fortyguard.com'
    fortyguard_timeout_seconds: float = 30.0
    fortyguard_poll_interval_seconds: float = 2.0
    fortyguard_max_poll_attempts: int = 60
    fortyguard_granularity_meters: int = 100

    deepseek_api_key: str | None = None
    deepseek_base_url: str = 'https://api.deepseek.com'

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(',') if item.strip()]

    @property
    def resolved_database_path(self) -> Path:
        path = Path(self.database_path)
        if path.is_absolute():
            return path
        return Path(__file__).resolve().parents[2] / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
