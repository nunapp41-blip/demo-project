# CreatorPulse: Real-time Data and Deployment Audit (v0.6)

## What is genuinely live in the hosted public preview
- `GET /healthz`, `/readyz`, `/v1/system/status`: real Node process and runtime integration flags, refreshed on the frontend every 30 seconds.
- `GET /v1/public/video/:videoId/metadata`: real public title and channel data via the official YouTube oEmbed endpoint on demand. Cached up to five minutes. Views and rankings explicitly absent.
- The Title Analyzer uses actual input and a deterministic local writing heuristic (not an AI prediction).

## What is not live yet
- Views, likes, subscriber counts, views-per-hour, keyword ranks: require `YOUTUBE_API_KEY` for the YouTube Data API v3. Public statistics may be cached/delayed by Google: 'live' is an API snapshot and not an instantaneous event stream.
- Private video retention curves: Google OAuth, owner consent, YouTube Analytics API, often OAuth verification. No transcript-line mapping.
- Real public user accounts: requires durable storage, TLS, secure secrets, policies, backup/restore, operational review. Public demo must remain registration-disabled until these conditions are met.
- Payments: live merchant credentials, subscriptions, webhook verification, cancel/refund handling and sandbox/live transaction tests.
- Chrome Web Store: extension build and store approval, privacy review, and testing against current YouTube layout.

## Reasons this cannot truthfully be declared 100% complete
- No owner-provided Google Cloud keys or OAuth client.
- No verified durable production database. Render free web service loses local SQLite data on restart; free Render Postgres expires in 30 days. It is unsafe to invite real production users with these defaults.
- No verified Stripe or Razorpay merchant integration/approvals, no confirmed public domain or Chrome Web Store approval.

## How to inspect backend
Open `/backend.html` on the deployed host, or `/v1/system/status` for direct JSON. The server exposes no credentials on either endpoint. Full API and auth code is under `apps/api/`.

## Local multi-user test (real SQLite on YOUR computer)
`AUTH_MODE=accounts ALLOW_REGISTRATION=1 ENCRYPTION_SECRET=<32+ random chars> node apps/api/server.mjs`
See README for setup. Do not publish that server without durable storage and HTTPS security.
