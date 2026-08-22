from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_env: str = 'development'
    heatshield_use_fixtures: bool = True
    cors_origins: str = 'http://localhost:5173'

    fortyguard_api_key: str | None = None
    fortyguard_base_url: str | None = None
    fortyguard_site_intelligence_path: str | None = None

    deepseek_api_key: str | None = None
    deepseek_base_url: str = 'https://api.deepseek.com'

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(',') if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
