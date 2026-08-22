# HeatShield

HeatShield is an operational heat-risk intelligence platform for field teams. This repository is a clean-slate build focused on three production screens: Site Intelligence, Add Worker, and Generate Plan.

## Current milestone

**Screen 1 — Site Intelligence** is implemented as the production foundation. It includes the approved enterprise UI, Google Maps integration boundary, worker/site models, responsive layout, risk metrics, environmental intelligence, and a backend API contract designed for FortyGuard integration.

## Stack

- Frontend: React 18 + TypeScript + Vite
- Styling: custom CSS design system
- Maps: Google Maps JavaScript API
- Backend: FastAPI + Pydantic
- Heat intelligence: FortyGuard adapter boundary
- Planning layer: DeepSeek adapter boundary (added when Screen 3 is built)

## Run locally

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Configuration

The app can run in local fixture mode while API keys are being connected. Production should set `HEATSHIELD_USE_FIXTURES=false` and configure the backend service adapter.

Never commit real API keys.
