from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agriculture_routes import router as agriculture_router
from app.api.routes import router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title='HeatShield API',
    version='1.0.0',
    description='Operational heat-risk intelligence API',
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'DELETE', 'OPTIONS'],
    allow_headers=['*'],
)

app.include_router(router)
app.include_router(agriculture_router)
