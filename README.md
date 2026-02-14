# NJ + Princeton Transit Explorer

Interactive map for:

- **All NJ Transit bus routes**
- **Princeton transit routes** (TigerTransit, Princeton Loop, Weekend Shopper, and related shuttles)

## Features

- Searchable route catalog grouped by agency
- Multi-route overlays with distinct colors
- Stop popups with route/stop details
- Optional full schedule popups when built with full dataset mode
- Mobile-friendly controls: collapsible panel + location centering
- Installable web app support (`manifest.webmanifest` + service worker)

## Official Data Sources

- NJ Transit GTFS: `https://www.njtransit.com/bus_data.zip`
- Princeton Transit (TripShot) GTFS: `https://princeton.tripshot.com/v1/gtfs.zip`

## Build or Refresh Dataset

Full dataset (includes stop-level schedules, larger files):

```bash
./scripts/build_njt_data.py --refresh
```

Web-slim dataset (faster/lighter for deployment):

```bash
./scripts/build_njt_data.py --web-slim --refresh
```

Generated output paths:

- `data/manifest.json`
- `data/routes/*.json`

## Run Locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to Vercel (Claimable, No Project Needed)

This repo includes the `vercel-deploy-claimable` skill at:
`./.agents/skills/vercel-deploy-claimable`

Deploy from repo root:

```bash
tmp=$(mktemp /tmp/njt-vercel.XXXXXX.tgz)
tar -czf "$tmp" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.agents' \
  --exclude='scripts' \
  --exclude='data/*.zip' \
  --exclude='.vercel' \
  .
bash ./.agents/skills/vercel-deploy-claimable/scripts/deploy.sh "$tmp"
```

The command returns:

- `Preview URL`: live deployment link
- `Claim URL`: transfer deployment into your Vercel account

Packing a slim tarball avoids claimable endpoint payload limits from large raw GTFS zip files.

## Deployment Notes

- `vercel.json` sets caching and security headers for static assets and route data.
- `.vercelignore` excludes local-only files (`scripts/`, raw GTFS zip files, and skill folders) from deployment uploads.
- `data/routes/*.json` remains lazy-loaded to keep initial page load fast.
- For claimable deployment size limits, use `--web-slim` route data.
