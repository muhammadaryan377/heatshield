import json
from pathlib import Path

from app.schemas import SiteIntelligence

DATA_DIR = Path(__file__).resolve().parent.parent / 'data'


def load_site_fixture(site_id: str) -> SiteIntelligence:
    path = DATA_DIR / f'{site_id}.json'
    if not path.exists():
        raise FileNotFoundError(site_id)
    return SiteIntelligence.model_validate(json.loads(path.read_text(encoding='utf-8')))
