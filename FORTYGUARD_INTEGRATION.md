# HeatShield × FortyGuard integration

HeatShield treats FortyGuard as its thermal evidence layer and keeps operational decisions separate from provider facts.

## Implemented capability matrix

| FortyGuard capability | HeatShield implementation |
| --- | --- |
| TCM heatmap | Home Thermal Explorer, site-clipped cells, worker-to-cell join |
| Map Statistics | Minimum/maximum/mean in Thermal Explorer; standard deviation and distribution/frequency normalized in the extended evidence API |
| Time of Measure | Completed-day profile and Heat History peak-time layer |
| Exceedance | Heat History and daily profile threshold-hours layer |
| Persistence | Heat History and daily profile continuous-threshold-duration layer |
| Historical range | Heat History supports provider range-of-days analysis from 2019-01-01, max 31 days per run |
| Forecast heatmaps | Operational Planner compares NOW with configurable +1/+3/+6/+9/+12 hour FortyGuard scans |
| Environmental Parameters | Extended evidence endpoint exposes heat index, apparent temperature, wet bulb, humidity, precipitation, cloud, AQI components, methane, CO2 and solar GHI/DNI/DHI when returned by the plan |
| Satellite Segmentation | On-demand provider request, Base64 imagery + segmentation + class coverage, entitlement-aware fallback |
| Street View Segmentation | On-demand front view and optional rear view with imagery, segmentation and class coverage |
| Heat Intelligence | On-demand five-category report generation; temporary provider signed URL is consumed server-side and replaced by a short-lived HeatShield PDF route |
| Activity/status traceability | Provider activity IDs are preserved on heatmap, environmental, segmentation, history and report evidence |
| API usage | Billing-cycle usage endpoint normalized into plan/credits/remaining/limit/activity breakdown where returned |
| Worker join | Worker coordinates are joined to spatial thermal cells and operational zones; worker task, intensity, sun/shade/water context remains HeatShield-owned data |

## Evidence rules

- No provider value is synthesized when FortyGuard returns no usable result.
- HTTP 403 / plan-limited premium calls are surfaced as `premium_required`.
- Advanced premium calls are user-triggered so page loads do not spend credits silently.
- Environmental and segmentation requests are tied to the matched FortyGuard heat observation when the endpoint requires matching time/location context.
- Temporary Heat Intelligence signed URLs are never returned to the browser.
- Historical range requests follow the documented 2019-01-01 lower bound and one-month maximum range.

## Main endpoints

```text
POST /api/sites/{site_id}/heatmap
POST /api/sites/{site_id}/fortyguard-profile
POST /api/sites/{site_id}/historical-heat-behavior
POST /api/sites/{site_id}/operational-planner
POST /api/sites/{site_id}/fortyguard/environment
POST /api/sites/{site_id}/fortyguard/physical-context
POST /api/sites/{site_id}/fortyguard/heat-intelligence
GET  /api/fortyguard/reports/{report_id}
GET  /api/fortyguard/usage
```

The primary UI for advanced provider evidence is the **Provider Evidence Workbench** below Site Intelligence. Heat History and Generate Plan continue to own temporal history and forecast-driven operational decisions respectively.
