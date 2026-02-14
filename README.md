# NJ + Princeton Transit Explorer

Interactive map of NJ Transit bus routes and Princeton-area shuttle routes with route-level filtering, area-based selection, and stop-level schedule popups.

## Requirements
- `uv`
- Python 3.10+

## Local Development
1. Build data (refresh feeds + regenerate route/schedule JSON):
```bash
uv run scripts/build_njt_data.py --refresh
```

2. Start a local static server:
```bash
uv run python -m http.server 8000
```

3. Open:
```text
http://localhost:8000
```

## Data Build Modes
Default (recommended): route geometry in `data/routes/` plus schedule payloads in `data/schedules/`.
```bash
uv run scripts/build_njt_data.py --refresh
```

Inline schedules (larger route files, fewer hover fetches):
```bash
uv run scripts/build_njt_data.py --inline-schedules --refresh
```

No stop schedules (smallest payload):
```bash
uv run scripts/build_njt_data.py --no-stop-schedules --refresh
```

## Repository Layout
```text
src/
  app/
    routes/
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
index.html
styles.css
sw.js
```

## Notes
- Route files are lazy-loaded when selected.
- Schedule files are prefetched after route load so stop hover popups render quickly.
- GTFS archives are cached under `data/` for reproducible rebuilds.
