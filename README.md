# HeatShield AI

**Evidence-bound agentic heat decisions powered by FortyGuard.**

HeatShield is an operational heat-intelligence platform that turns hyperlocal thermal evidence into reviewable decisions for real-world teams. One bounded decision core is reused across four operating contexts: **Workforce Safety, Enterprise, Agriculture, and Urban Intelligence**.

The product is deliberately verified-first: provider observations, site geometry, worker/asset/field context, deterministic constraints, AI critique, human approval, and post-action verification are kept distinct. HeatShield does not invent temperature measurements when evidence is unavailable.

## Product thesis

Most heat dashboards stop at showing where it is hot. HeatShield is built to answer the next operational question:

> Given the evidence we actually have, what should a human operator review or change next — and can the result be verified afterward?

The shared decision pattern is:

**Observe → rank valid options → apply domain constraints → critique → propose → human review → verify**

DeepSeek, when configured, acts only as a bounded critic/explainer of evidence-grounded candidates. Deterministic code owns measurements, eligibility, constraints, scores, and provider status.

## Four domain toolkits

### Workforce Safety — flagship operational flow

1. Create a real work site and draw its polygon on Google Maps.
2. Add workers with exact positions, tasks, shifts, work intensity, sun exposure, shade, and water context.
3. Configure supervisor-approved operational zones and allowed tasks.
4. Request FortyGuard spatial heat evidence and atmospheric context.
5. Compare the current assignment with eligible **Better Time** and **Better Place** options.
6. Show evidence coverage, confidence factors, constraints, warnings, and bounded critic output.
7. Require supervisor approval before an operational change is recorded.
8. Request fresh evidence to verify the approved outcome when verification is available.

### Enterprise

Property and infrastructure teams can register sites and assets, inspect site-level thermal exposure, match critical assets to verified spatial cells, prioritize engineering review, inspect industrial/data-center context, assess portfolio priority, and generate heat-risk reports.

### Agriculture

Farm operators can manage farms and field boundaries, screen crop/field heat exposure, inspect persistence and temporal patterns, prioritize irrigation-system inspection, plan field work timing, and review alerts without substituting synthetic heat measurements.

### Urban Intelligence

Urban resilience teams can define districts, identify relative heat-island candidates, inspect urban heat drivers, record interventions, and compare matched before/after evidence while keeping correlation and causation claims separate.

## FortyGuard evidence core

HeatShield integrates FortyGuard server-side and currently uses its thermal/environmental workflow through the Temperature API, including:

- heatmap job submission and activity-status polling;
- spatial thermal cells for site, worker, asset, field, and district analysis;
- environmental-parameter context when available;
- completed-hour fallback handling when the current hour has no usable spatial tiles;
- last-completed-day temporal profiles for threshold exceedance, persistence, and peak-time context;
- historical heat-behavior analysis over user-selected periods.

Every screen distinguishes verified, partial, unavailable, fallback, cached, or configuration-required states as appropriate. A successful request is not treated as evidence unless usable provider values are actually returned.

## Agent architecture

HeatShield uses a bounded-agent architecture rather than asking an LLM to generate operational facts.

1. **Observe** — collect the selected boundary, operational records, and available FortyGuard evidence.
2. **Generate / rank** — deterministic services create valid candidates and calculate evidence-backed priority.
3. **Constrain** — enforce shift windows, approved zones, task compatibility, asset/field/intervention context, and evidence availability.
4. **Critique** — DeepSeek may flag missing context or caveats, but cannot alter measurements or candidate eligibility.
5. **Propose** — return one reviewable next action with explicit confidence and evidence warnings.
6. **Human gate** — operationally meaningful actions remain supervisor/operator controlled.
7. **Verify** — where supported, request fresh FortyGuard evidence after approval and record the observed result.

## Data-integrity policy

- Development fixtures are **disabled by default**.
- The product starts with no fake sites, workers, assets, fields, or live environmental readings.
- FortyGuard API keys and DeepSeek keys stay in the backend environment only.
- Missing current-hour heat tiles are never silently presented as live values; recent completed-hour evidence is explicitly labelled.
- Atmospheric fallback data is not used to fabricate a FortyGuard spatial thermal map.
- Provider evidence and HeatShield-derived decisions are presented separately.
- The UI exposes loading, empty, partial-evidence, configuration, and failure states instead of substituting plausible-looking numbers.

## Platform readiness

`/platform-readiness` provides a non-secret operational readiness view for:

- FortyGuard configuration;
- optional DeepSeek configuration;
- Google Maps client configuration;
- site/worker/zone workspace prerequisites;
- production-safe fixture mode;
- per-module readiness and attention items.

The readiness check itself does not submit FortyGuard jobs.

## Stack

- **Frontend:** React 18, TypeScript, Vite
- **Maps:** Google Maps JavaScript API
- **Charts:** Recharts
- **Backend:** FastAPI, Pydantic
- **Persistence:** SQLite
- **Thermal evidence:** FortyGuard Temperature API
- **Atmospheric fallback/context:** US National Weather Service where applicable
- **Bounded AI critic:** DeepSeek API
- **CI:** GitHub Actions production frontend build + backend compile/smoke flow

## Run locally

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Configure `backend/.env` as needed:

```env
FORTYGUARD_API_KEY=your_server_side_key
DEEPSEEK_API_KEY=your_optional_server_side_key
CORS_ORIGINS=http://localhost:5173
HEATSHIELD_USE_FIXTURES=false
```

Do not put server-side API keys in the frontend or commit them to Git.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Configure the browser-restricted Maps key:

```env
VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

In normal local development, leave `VITE_API_BASE_URL` blank; Vite proxies `/api` to the local backend.

Open `http://localhost:5173`.

## Health and validation

Backend health check:

```text
GET /api/health
```

GitHub Actions validates the production frontend build and a backend smoke flow covering real-workspace setup, agriculture fields, historical behavior, domain agents, workforce planning, supervisor approval, and verification-unavailable behavior without requiring secrets in CI.

## Recommended hackathon demo path

For the clearest end-to-end story, demo the Workforce flow first:

**Site boundary → worker context → FortyGuard evidence → agent compares Now / Better Time / Better Place → supervisor approval → verification**

Then show that the same evidence policy and bounded decision core already extend to Enterprise assets, Agriculture fields, and Urban interventions.

## Security notes

- Keep all server-side secrets in environment variables.
- Restrict the Google Maps browser key to approved domains and required APIs.
- Configure production CORS explicitly.
- Never commit real API keys, `.env` files, or private credentials.
