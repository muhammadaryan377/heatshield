# HeatShield

HeatShield is an operational heat-risk intelligence platform for field teams. This is a clean-slate product build focused on three production screens: Site Intelligence, Add Worker, and Generate Plan.

## Product behavior

HeatShield starts with **no fake sites, no fake workers, and no fabricated environmental readings**.

The real workflow is:

1. Create a work site.
2. Search the location on Google Maps.
3. Click around the complete work area to draw and save the site polygon.
4. Create additional sites whenever needed and switch between them from the Home selector.
5. Add real workers to the selected site and place each worker at an exact map position.
6. HeatShield requests verified environmental evidence from FortyGuard for the selected site.
7. If FortyGuard is not configured or does not return a usable observation, the UI shows an explicit unavailable state instead of substitute values.
8. Screen 3 will use this factual site + worker + heat context for operational planning with DeepSeek.

## Current implementation

### Screen 1 — Site Intelligence

- first-run empty state
- multi-site creation and persistent site storage
- Google Maps address search and polygon drawing
- site selector and live refresh
- worker count derived from saved workers only
- real worker markers only
- live FortyGuard heatmap + environmental-parameters orchestration
- honest provider/configuration failure states
- risk calculated only from verified environmental values

### Screen 2 — Add Worker foundation

- selected-site assignment
- name, role, task and work intensity
- shift times
- sun exposure, shade access and water access
- exact worker position on the site map
- persistent backend storage
- redirect back to the selected Home site after save

## Stack

- Frontend: React 18 + TypeScript + Vite
- Styling: custom HeatShield design system
- Maps: Google Maps JavaScript API
- Backend: FastAPI + Pydantic
- Persistence: SQLite for the current product build
- Heat intelligence: FortyGuard `/v1/heatmap`, `/v1/status/{activity_id}`, `/v1/env_params`
- Planning layer: DeepSeek API (Screen 3)

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

Set `FORTYGUARD_API_KEY` in `backend/.env`. Never put it in the frontend.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`. Restrict the browser key to your approved domains and Maps JavaScript API.

Open `http://localhost:5173`.

## Data policy

Development fixture data is disabled by default. HeatShield does not present sample observations as live product data.

Never commit real API keys.
