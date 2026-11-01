# CreatorPulse — self-hosted YouTube Growth Platform

A working **local-first, no-Lovable, no-subscription prototype** based on the 14-section YouTube Growth Platform handbook. Original dark UI (`#090D1B`, `#805BFF`, `#38BDF8`, `#B8FF65`). All source code is editable and MIT licensed.

**IMPORTANT:** This is not a production-complete vidIQ replacement. Google OAuth, audience-retention analytics, email alerts, paid billing, public deployment, Redis/PostgreSQL integration, and production multiuser security are NOT completed. We do not fabricate live metrics. The full 12-week roadmap cannot be completed or deployed without user-controlled service accounts and external setup.

## Quick start (no npm install required)

Node.js 22+ only:

```bash
node apps/api/server.mjs
```

Open **http://127.0.0.1:8787** on the **same computer**. This starts the API and serves the full dark dashboard. All local UI components work in demo mode without credentials. The server listens on loopback only by default; **do not expose it to the public internet**.

### Windows

Open the folder in VS Code; open Terminal; run `node apps/api/server.mjs`. On Windows you can also double-click `RUN_WINDOWS.bat` after installing Node.js 22+.

### Enable public YouTube video statistics

1. In Google Cloud Console, create your own project and enable **YouTube Data API v3**. Obtain an API key; secure/restrict it and keep it out of source code.
2. Start the local API with the key in an environment variable:

```powershell
# Windows PowerShell
$env:YOUTUBE_API_KEY="your-own-key"
node apps/api/server.mjs
```

```bash
# Linux / macOS
YOUTUBE_API_KEY="your-own-key" node apps/api/server.mjs
```

3. Open **Live API Tools** from the dashboard; enter a real public video URL. View metadata, actual public view counts, likes and comments, **calculated average VPH** and **estimated outlier score** (based on recent uploaded videos when available).
4. Keyword research uses live public search results but demand/difficulty numbers are only clearly labeled **proxies**. The API does **not** provide genuine keyword search volume.
5. Add a video+keyword to the live rank tracker and click **Check rank**. Data is saved locally in `data/local.json` and can be reviewed in **History**. Automatic daily checks require `ENABLE_LIVE_RANK_CHECKS=1` (see cautions below).

### Local Chrome Extension

1. In Chrome open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** → choose `apps/extension`.
4. Keep the local API server running. Open a video on YouTube; CreatorPulse shows the sidebar. If the key isn't configured, it shows a clear setup message instead of fake statistics.

No paid tool, Chrome Web Store publishing, or Lovable is required for unpacked local installation.

### Optional local AI

Run free, open-weight models with Ollama on your own machine. Set `ENABLE_OLLAMA=1`, `OLLAMA_MODEL` and `OLLAMA_BASE_URL` (defaults to http://127.0.0.1:11434). Use the `POST /v1/ai/titles` route with `{"topic":"your topic"}`. Models may have independent licenses; installing them is optional.

### Automated tests

```bash
npm test
npm run check
```

Seven tests cover API routing, local tracking, validation, scoring, quota handling and mocked YouTube data. All pass on Node 22 in the build environment.

## Repo map

```
apps/web/public/       Dark responsive dashboard, demo tools, connected Live API Tools
apps/api/              Local Node HTTP API, persistent JSON, YouTube Data API wrapper
apps/extension/        Manifest V3 YouTube overlay and background service worker
packages/shared/       Shared transparent score computations
infra/schema.sql       Future PostgreSQL schema
infra/docker-compose.yml Optional Postgres + Valkey for planned architecture
.github/workflows/     Test/check GitHub Actions workflow
tests/                 Node's built-in test runner
docs/                  Architecture, API and honest handbook progress
```

## Current capabilities and limits

| Feature | Current implementation |
|---|---|
| Responsive dashboard | Real working static UI and navigation; overview cards show demo data |
| Title analyzer | Local deterministic heuristic + API endpoint; NOT an algorithm prediction |
| Keyword Explorer | Filter demo dataset offline; live API-backed proxies with key |
| Video scorecard | Official public YouTube statistics with key, transparent metrics |
| Rank tracking | Save real video+keyword, manual checks, history; optional scheduler when enabled |
| Competitors | Local tracking records and live channel metadata when API key is set |
| Chrome Extension | Real public stats via local API when key is present; errors otherwise |
| Hindi | Keyword input and locale support; full Hindi UI translation incomplete |
| AI | Optional local Ollama title generation API; no cloud AI required |
| Google OAuth/Retention | Status/error endpoint only, requires Google authorization; NOT implemented |
| Paid subscriptions | Not implemented; no payment credentials held |
| Production auth | Not implemented; local single-user development only |
| PostgreSQL / Valkey | Optional docker services and schema, not wired to running API |
| Next.js / Fastify | Planned production stack; offline zero-dependency working implementation uses vanilla JS + Node built-ins |

## API routes

`GET /healthz`, `GET /readyz`, `GET /v1/me`, `GET /v1/config`, `GET /v1/usage`, `POST /v1/title/analyze`, `GET /v1/demo/scorecard`, `GET /v1/videos/:ytId/scorecard`, `GET /v1/keywords/research?q=...&locale=hi`, `GET|POST /v1/rank/track`, `DELETE /v1/rank/track/:id`, `POST /v1/rank/:id/check`, `GET /v1/rank/:id/history`, `GET|POST /v1/competitors`, `GET /v1/channels/:id/outliers`, `GET /v1/retention/status`, `POST /v1/ai/titles`.

## YouTube API policy and quota

Use only official YouTube public API endpoints (no private API scraping). Google has recently changed its quota structure: its current documentation describes a separate **100-search-requests/day bucket** and a 10,000-unit combined quota for other endpoints for new enabled projects. Verify project-specific quotas in Google Cloud before deployment. The local quota guard is a conservative approximation, not a substitute for Google's quotas. Cache data in accordance with YouTube API Policies and delete/refresh when required. Do not represent estimated competition, VPH or ranking as official YouTube metrics.

## License

MIT for original implementation; review licenses of optional dependencies and models. No vidIQ logos, code, or text are used.
