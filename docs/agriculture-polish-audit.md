# Agriculture module polish audit

This checkpoint covers the seven-screen Agriculture stack from Overview through Alerts.

## Verified architecture

- Farm scope reuses saved Site polygons; field scope uses separately persisted Agriculture field polygons.
- FortyGuard remains the only source of spatial thermal cells.
- NWS is used only for US site-level atmospheric observation / hourly forecast context when the FortyGuard live-condition path falls back.
- Crop, growth stage, irrigation and worker details remain HeatShield context rather than provider-derived facts.
- Missing thermal evidence is displayed as unavailable; no synthetic heat cells are generated.

## Hardening in this polish branch

- Fixed strict TypeScript state typing in the field-boundary modal.
- Added shared focus, disabled-state, reduced-motion and responsive interaction polish across all Agriculture screens.
- Added official NWS hourly atmospheric forecast context for fallback mode so Overview and Field Work Planner can show a real forecast horizon instead of an always-empty array.
- Added server-side field-polygon checks for distinct vertices, non-zero area and self-intersection before a field can reach FortyGuard.
- Extended CI smoke coverage to field create / list / profile configuration gate / delete.

## Decision boundaries retained

- Thermal screening thresholds are user-configured screening values, not crop-damage thresholds.
- Irrigation outputs are inspection priorities until soil moisture, ET/crop demand and irrigation-system constraints are available.
- Atmospheric forecast temperatures are not presented as field-surface temperatures.
- Field-work recommendations remain planning context; supervisor controls and applicable occupational requirements govern final work/rest decisions.
- Alert acknowledgement only records review state; it does not clear the underlying condition.

## Local release checks

Run from `frontend/`:

```bash
npm install
npm run build
npm run dev
```

Run from `backend/`:

```bash
python -m compileall app
```

With the backend running, manually verify farm creation, field drawing, field deletion, each FortyGuard layer state, NWS fallback messaging, field-work forecast context, and Alerts acknowledgement persistence.
