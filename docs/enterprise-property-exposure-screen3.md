# Enterprise Property Heat Exposure — Screen 3

This screen intentionally separates two FortyGuard evidence timelines instead of pretending they are the same observation:

- **Temperature** uses the latest verified TCM spatial layer returned by the existing `/api/sites/{site_id}/heatmap` endpoint.
- **Exceedance, persistence and peak time** use a user-selected completed day from `/api/sites/{site_id}/historical-heat-behavior`.

The UI never paints synthetic provider cells. If a layer is unavailable, the map shows an explicit unavailable state.

The selected threshold is entered in Celsius for the enterprise UI and converted to Fahrenheit only because the existing historical endpoint contract accepts `thresholdF`; the backend returns the canonical threshold in both Fahrenheit and Celsius.

The screen is decision-oriented but keeps provenance visible. HeatShield interpretation is derived from returned exposure duration/persistence values and is visually separated from provider evidence.
