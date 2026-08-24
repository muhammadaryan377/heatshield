from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_ROOT / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding='utf-8',
        extra='ignore',
    )

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
    # Heat Intelligence and segmentation can take longer than a heatmap. Keep
    # bounded polling, but allow up to four minutes before declaring timeout.
    fortyguard_max_poll_attempts: int = 120
    fortyguard_granularity_meters: int = 100
    # The provider can complete the newest hour before temperature tiles are
    # available. Retry a small number of recent *site-local* whole hours.
    fortyguard_recent_hour_fallbacks: int = 3
    # Avoid spending provider credits repeatedly on browser refreshes.
    fortyguard_cache_ttl_seconds: int = 600
    # After a full zero-tile sequence, stop retrying FortyGuard for a short
    # period and serve official site-level conditions from the fallback source.
    fortyguard_failure_cooldown_seconds: int = 900

    # Official US National Weather Service fallback. No API key is required.
    nws_base_url: str = 'https://api.weather.gov'
    nws_timeout_seconds: float = 12.0
    nws_user_agent: str = 'HeatShield/1.0 (operational heat safety application)'

    deepseek_api_key: str | None = None
    deepseek_base_url: str = 'https://api.deepseek.com'
    deepseek_model: str = 'deepseek-chat'
    deepseek_timeout_seconds: float = 30.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(',') if item.strip()]

    @property
    def resolved_database_path(self) -> Path:
        path = Path(self.database_path)
        if path.is_absolute():
            return path
        return BACKEND_ROOT / path

    @property
    def fortyguard_configured(self) -> bool:
        return bool(self.fortyguard_api_key and self.fortyguard_api_key.strip())

    @property
    def deepseek_configured(self) -> bool:
        return bool(self.deepseek_api_key and self.deepseek_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
