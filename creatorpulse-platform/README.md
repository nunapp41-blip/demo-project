# CreatorPulse v1.0 — Google official bulk video statistics

## What is implemented

- `POST /v1/public/videos/batch` accepts `{ "videos": ["VIDEO_ID", "https://www.youtube.com/watch?v=VIDEO_ID"] }`, 1–50 entries. Only canonical YouTube IDs/URLs are accepted; duplicates are de-duplicated. One official Google `videos.batchGetStats` request covers the uncached IDs, and the backend caches public snapshots for five minutes. It returns original Google values, timestamps, nullable statistics, stale results on upstream failure and a calculated VPH from separate valid snapshots. **An API key is mandatory to see counts.**
- `GET /v1/public/channel/UC.../latest-stats?count=25` uses the official `channels.list`, uploads `playlistItems.list`, and `videos.batchGetStats` to show up to 50 recent publicly accessible uploads and their current public views; no made-up results.
- On `realtime.html`, a bulk URLs textarea and channel latest-views interface with optional 60-second display refresh are available. Server data cache avoids a Google call on every refresh. These are not instantaneous YouTube events.

## Live activation required

Create your own free key in the Google Cloud Console and enable **YouTube Data API v3** in that project. In Render's `creatorpulse-open-source-app` service, open **Environment** and add `YOUTUBE_API_KEY` as a secret env var, then redeploy. Do **not** paste it into chat or GitHub. Use the secure key restriction suitable for server requests. The public demo remains read-only for private accounts; official public data endpoints become operational when the key is present. Test `GET /v1/public/quota` first, then a real video ID via `POST /v1/public/videos/batch`.

No subscription or Lovable is required. YouTube's API is quota-limited; even official public view counts can lag behind YouTube Studio. Persistent user records require an external durable database and deployment credentials.

# CreatorPulse v0.9 — official limited API integration

**Deployment prerequisites:** Set the server-side `YOUTUBE_API_KEY` in Render (or your self-hosted environment), with the YouTube Data API v3 enabled and restricted in Google Cloud. This account-owned credential is free to request and the default project quotas are limited. Without it, view/comment/search metrics deliberately report UNAVAILABLE; public oEmbed metadata and channel RSS remain keyless. Never paste a key in public GitHub or send it in chat.

**New endpoints:** `GET /v1/public/video/:id/comments`, `GET /v1/public/channel/:channelId/statistics`, `GET /v1/public/quota`. Existing `GET /v1/public/video/:id/stats` uses official batchGetStats, `/v1/public/search` uses official search.list. New UI sections on `/realtime.html` display comments, channel statistics and quota counters.

**Quota rules:** Official YouTube Data API (2026) uses separate default buckets for search.list 100 calls/day, videos.batchGetStats 10,000 calls/day, plus general API quota (usually 10,000 units/day). Source: https://developers.google.com/youtube/data/determine_quota_cost ; see Cloud Console for actual usage. Each endpoint uses caching and per-IP limits; local counters are approximate and reset on ephemeral hosting.

**Important:** Live API stats are not instantaneous. They represent YouTube's latest publicly reported values. Comments endpoint returns available top-level public comment threads, not private data or every reply. The public demo remains deliberately unauthenticated/read-only until durable production database and secure account deployment are available.

# CreatorPulse — open-source YouTube Growth Platform

**Status: v0.8 — runnable self-hosted alpha + publicly hosted read-only demo. Not a fully launched, approved, production SaaS.** This code is original and does **not** depend on Lovable or any paid website builder. JavaScript and Node.js built-ins are enough to run locally. User-requested theme: midnight navy `#090D1B`, purple `#805BFF`, bright blue `#38BDF8`, neon lime `#B8FF65`.

## Check live backend

Visit `backend.html` for an automatically refreshed health/readiness and integration console. Use the Live Tools page to retrieve **actual public video title/channel** without credentials, powered by the official YouTube oEmbed endpoint. This is not equivalent to public video view counts or real-time video analytics; those still require an official YouTube Data API key. See `docs/REALTIME_AUDIT.md`.

## November 2 implementation — official-data v0.7

The user uploaded a 20-page Word document and 11-page PDF describing free real-time YouTube analytics. We reconciled these proposals in `docs/DOCUMENT_RECONCILIATION.md`. The official 2026 Google API supports `videos.batchGetStats`, with a separate daily bucket; `search.list` has its own small quota. We **did not** implement private InnerTube scraping suggested by the Word file, because the PDF and Google policy warn that it is not a legitimate guaranteed production pipeline.

**Run the new official data page** at `/realtime.html`. With no Google key, it can retrieve genuine public title/channel via YouTube oEmbed and explicitly returns UNAVAILABLE for views and keyword search. If you set a Google API key on the server, it uses official `videos.batchGetStats` for public counts and official `search.list` for region-scoped search samples. These are cache- and quota-limited, not instant internal YouTube analytics. VPH from `GET /v1/public/video/VIDEO_ID/stats` is computed only after two actual snapshots; these Render/local snapshots are not durable unless a persistent store is configured.

**New persistent architecture:** `cloudflare/` contains a Cloudflare Worker + D1 database schema, a 5-minute Cron refresh with batch collection, daily quota accounting, cache, 29-day public data expiry, rate-limited public endpoints, and an admin-protected track route. It is **code ready for user-owned Cloudflare deployment, not deployed live**: follow `cloudflare/README.md` to connect Google API key and D1. Full production accounts/OAuth/Reporting API/billing remain externally gated and not live.

Current URL (Render public preview): https://creatorpulse-open-source-app.onrender.com/realtime.html

## See it

- `landing.html`: public marketing landing page, features, FAQ and proposed plans.
- `index.html`: interactive dark dashboard. Demo analytics are labeled as samples.
- `#settings`: account registration/login, private stats, alerts, one-time extension code and deletion (only in authenticated mode).
- `#retention`: your own YouTube audience-retention analysis after authorized Google OAuth configuration.
- `#live`: real video scorecard, keyword research and rank snapshots after operator sets official YouTube API key.

## Getting started locally — no npm install, no paid tools

Install **Node.js 22+**. Clone or download the source and open a terminal inside the project folder:

```bash
node apps/api/server.mjs
```

Open <http://127.0.0.1:8787/> in Chrome. The dashboard, sample keyword search, title analyzer, design preview and local tools are usable. You can also open <http://127.0.0.1:8787/landing.html>.

### Run authentic multi-user accounts locally

Create a **strong permanent** random encryption secret; DO NOT publish it or regenerate it when accounts exist. On Windows PowerShell:

```powershell
$env:AUTH_MODE='accounts'
$env:ALLOW_REGISTRATION='1'
$env:ENCRYPTION_SECRET='replace-this-with-a-random-secret-of-at-least-32-chars'
node apps/api/server.mjs
```

On Linux/macOS:

```bash
AUTH_MODE=accounts ALLOW_REGISTRATION=1 ENCRYPTION_SECRET='replace-this-with-your-random-32-plus-character-secret' node apps/api/server.mjs
```

Open **Account & Settings** in the website. Create two accounts and check that each has its own tracked keywords, competitors, rank history and alerts. Passwords are scrypt-hashed; opaque sessions are stored as SHA-256 hashes with HttpOnly SameSite=Lax cookies; one-use extension codes exchange for revocable access tokens; OAuth refresh tokens are AES-256-GCM encrypted. The built-in SQLite database lives in `data/creators.sqlite`. Back up the file and keep your secrets out of git. SQLite in Node 22 is still an experimental API; pin/test your runtime before production.

**Do not expose this instance publicly without persistent storage, SSL/TLS, secure cookies, application secret management, consent/legal policies, backups and a security review.** In production, configure `HOST=0.0.0.0`, `PUBLIC_ORIGIN`, `SECURE_COOKIES=1`, `PERSISTENT_STORAGE_CONFIRMED=1`, strong `ENCRYPTION_SECRET`, `AUTH_MODE=accounts`, and attach a persistent disk. The startup gate rejects unsafe account-mode configurations. The `PERSISTENT_STORAGE_CONFIRMED` flag is **an operator attestation, not an automatic durability check**.

### Read-only public demo

```bash
HOST=0.0.0.0 PUBLIC_DEMO=1 node apps/api/server.mjs
```

Public demonstration mode allows visitors to view the frontend and run a local deterministic title analyzer. It blocks accounts, private tracking, AI, and live YouTube data. The frontend labels the limitations. This is appropriate for a free preview that lacks durable database hosting.

## Official YouTube Data API (optional)

1. Set up your own Google Cloud project and enable **YouTube Data API v3**.
2. Restrict and store its key as `YOUTUBE_API_KEY` on the server, never in frontend/extension code.
3. Open the Live API Tools section and fetch a public video's scorecard, or research a keyword.
4. For rank history, save a real video+keyword combination and click Check Rank. You can enable periodic checks with `ENABLE_LIVE_RANK_CHECKS=1` or start `node apps/worker/worker.mjs` (worker requires accounts mode); don't run duplicate jobs.
5. Daily quota is shared by your app, not per user. Google documents a 100 `search.list` calls/day quota and other quotas; the app has conservative guards. Scores are estimated from top result samples; **there is no official search volume endpoint**.

## Owner-only Retention Doctor (optional)

Create a Google Cloud OAuth **web application**, verify the authorized domain, enable **YouTube Analytics API**, and set these backend environment variables:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://YOUR_DOMAIN/oauth/google/callback
ENCRYPTION_SECRET=the-permanent-random-secret
```

On the Retention Doctor screen, the creator signs in and selects **Connect my YouTube channel**. The backend requests `youtube.readonly` and `yt-analytics.readonly`, stores the refresh token encrypted at rest, and then makes an owner-authorized `reports.query` call with `channel==MINE`, `video==VIDEO_ID`, `elapsedVideoTimeRatio` and `audienceWatchRatio`. The app shows real retention points and largest drop points when available. Google OAuth app verification, real-user consent and API audit are **not** complete in this repository. Transcript-line mapping is not implemented; do not claim it is.

## Chrome extension (unpacked local development)

1. Open `chrome://extensions`, enable Developer Mode.
2. **Load unpacked** → select `apps/extension`.
3. Start the CreatorPulse local backend on port 8787; in multiuser mode, log in to CreatorPulse Settings and generate a five-minute code.
4. Paste the code into the popup to connect the extension to your account. Open any public YouTube watch page; the Shadow DOM overlay fetches official API-backed scorecards from your local API.
5. No Store deployment has been submitted. The extension currently targets **localhost**, not arbitrary public domains. Content scripts never see the API token.

## Stripe/Razorpay billing preparation (optional)

The app includes server-side Stripe hosted subscription checkout code, signed Stripe webhook validation, account plan updates on verified checkout events, and a signature-validated Razorpay webhook **receiver only**. No plan has a published price, no checkout secrets are configured, and no real payments have been processed. Razorpay checkout/subscription reconciliation and cancellation/refund terms must be finished before accepting real payments. Stripe requires `STRIPE_SECRET_KEY`, `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_AGENCY` and `STRIPE_WEBHOOK_SECRET`. Do not expose private API keys.

## Local AI (optional)

Run a free locally hosted Ollama model and set `ENABLE_OLLAMA=1`, `OLLAMA_MODEL` and `OLLAMA_BASE_URL`. The AI suggestion API is available to authenticated users in account mode. AI output is advice, not fact, and model licenses/compute are the responsibility of the operator.

## Verification

```bash
npm test          # 11 automated tests, including multiuser isolation and webhook signature rejection
npm run check     # syntax checks
```

CI runs tests on push. The repository includes original marketing copy, a proposed privacy policy and terms **drafts** (not legally approved), and a detailed implementation checklist in `docs/HANDBOOK_CHECKLIST.md`.

## Important limitations

- This implementation uses native Node.js + SQLite/JSON in place of the PDF's planned Next.js/Fastify/Postgres/Valkey stack, because package registry access is unavailable in this environment. Production database and Redis workers are **not** integrated.
- Sample data is not real and is identified. Public YouTube statistics need a live API key. YouTube Analytics requires owner OAuth. No unauthenticated public analytics API.
- No public account deployment on free ephemeral hosting. Real users require durable database, secure production hosting, account verification and a legal/privacy review.
- No fully localized Hindi interface, caption mapping, verified payments, Chrome Web Store approval, or production monitoring. All remain open handbook items.
- We do not copy vidIQ code, branding, UI assets or private data.

**License:** MIT for the original code. External APIs, hosting services, models and libraries may have additional terms and expenses.


## November 2 update — keyless public-channel feeds (v0.8)

A new **working code path** accepts a public `UC…` channel ID and calls YouTube's public Atom feed without a Google API key: `GET /v1/public/channel/UC.../uploads`. Search a substring of the recent titles using `?q=term`. The real-data page at `/realtime.html` contains a direct search UI. The feed normally provides only the last ~15 uploads, not the entire YouTube video catalog. It can optionally include `<media:statistics views="…">`; view counts are returned **only when present**, and remain `null` otherwise. Feed fetching is cache-limited (5 minutes), input validated, stale-cache fallback is labeled. This is **not** a universal keyword rank or unrestricted data interface. Public feeds can fail or be rate-limited; a working code path and passing local tests are not proof of global upstream availability. Official public statistics and arbitrary keyword search still require a proper `YOUTUBE_API_KEY`.

Do not use undocumented private InnerTube endpoints, proxy rotation, multi-project quota evasion or another website's stolen API credentials.
