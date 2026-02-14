# NJ + Princeton Transit Explorer

Interactive web map for:
- All NJ Transit bus routes
- Princeton transit routes (TigerTransit, Princeton Loop, Weekend Shopper)

## What You Get
- Route search and multi-select controls
- Area-based route selection from current map viewport
- Colored route overlays with stop markers
- Stop-level schedule popups
- Offline-friendly app shell via service worker

## Requirements
- `uv`
- Python 3.10+

## Quick Start
1. Build or refresh route data:
```bash
uv run scripts/build_njt_data.py --refresh
```

2. Start a local server:
```bash
uv run python -m http.server 8000
```

3. Open:
```text
http://localhost:8000
```

## Data Build Modes
Default (recommended): simplified route geometry + external schedule files for fast initial load.
```bash
uv run scripts/build_njt_data.py --refresh
```

Inline schedules (larger per-route files, no extra schedule request on popup):
```bash
uv run scripts/build_njt_data.py --inline-schedules --refresh
```

No schedules (smallest payload):
```bash
uv run scripts/build_njt_data.py --no-stop-schedules --refresh
```

## Project Structure
```text
src/
  main.js
  config/
  data/
  map/
  ui/
  utils/
scripts/
  build_njt_data.py
data/
  manifest.json
  routes/
  schedules/
```

## Notes
- Route payloads are lazy-loaded from `data/routes/`.
- Schedule payloads are loaded from `data/schedules/` and prefetched after route selection for faster hover popups.
- GTFS source zips are stored under `data/` for reproducible rebuilds.
