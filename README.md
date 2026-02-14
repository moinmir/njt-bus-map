# NJ + Princeton Transit Explorer

Interactive map for:

- **All NJ Transit bus routes**
- **Princeton transit routes** (TigerTransit, Princeton Loop, Weekend Shopper, and related shuttles)

## Features

- Searchable route catalog grouped by agency
- Multi-route overlays with distinct colors
- Stop popups with route/stop details
- Stop-level schedule popups (optimized external schedule files by default)
- Mobile-friendly controls: collapsible panel + location centering
- Installable web app support (`manifest.webmanifest` + service worker)

## Official Data Sources

- NJ Transit GTFS: `https://www.njtransit.com/bus_data.zip`
- Princeton Transit (TripShot) GTFS: `https://princeton.tripshot.com/v1/gtfs.zip`

## Build or Refresh Dataset

Default optimized web build (shape simplification + lazy schedule files):

```bash
./scripts/build_njt_data.py --refresh
```

Inline schedules in route files (larger payloads, no schedule-file request on hover):

```bash
./scripts/build_njt_data.py --inline-schedules --refresh
```

No stop schedules (smallest payload, schedules omitted):

```bash
./scripts/build_njt_data.py --no-stop-schedules --refresh
```

Generated output paths:

- `data/manifest.json`
- `data/routes/*.json`
- `data/schedules/*.json` (default mode)

## Run Locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to Vercel

Deploy from repo root with the Vercel CLI:

```bash
vercel deploy
```

Deploy to production:

```bash
vercel deploy --prod
```

## Deployment Notes

- `vercel.json` sets caching and security headers for static assets and route data.
- `.vercelignore` excludes local-only files (`scripts/`, raw GTFS zip files, and skill folders) from deployment uploads.
- `data/routes/*.json` remains lazy-loaded to keep initial page load fast.
- `data/schedules/*.json` is cached and prefetched when routes are selected to keep hover popups responsive.
- For smallest deployment payloads, use `--no-stop-schedules`.
