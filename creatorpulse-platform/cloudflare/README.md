# Persistent official public YouTube data — Cloudflare Worker + D1

This is a deployable, self-contained **public data** service. It is NOT deployed yet (the operator must connect their Cloudflare account and API credentials). It does not support private user accounts, retention reports, billing or video uploads.

The source design follows the PDF's recommended Worker/D1 architecture, **not** the Word document's unofficial InnerTube search workaround. Nothing bypasses Google's API quotas.

## 1. Create free resources on your own accounts

- In Google Cloud Console, enable the **YouTube Data API v3** and create/restrict a project API key. Do not paste it into this chat or commit it to GitHub.
- Create a Cloudflare account and install official Wrangler CLI locally (`npm i -D wrangler`) for this folder. Login with `npx wrangler login`.
- Run `npx wrangler d1 create creatorpulse-public` and replace `REPLACE_AFTER_WRANGLER_D1_CREATE` in `wrangler.jsonc` with the returned database ID.
- Run `npx wrangler d1 migrations apply creatorpulse-public --remote`.
- Store credentials using `npx wrangler secret put YOUTUBE_API_KEY`, `npx wrangler secret put ADMIN_TOKEN`, `npx wrangler secret put RATE_LIMIT_SALT` (generate independent random values; the latter must be >=20 characters).
- Verify `ALLOWED_ORIGIN` points to the actual live website, then `npx wrangler deploy`.

## 2. Endpoints

- `GET /api/status`: real configured status + quota meters.
- `GET /api/video?id=VIDEO_ID`: official Google public counts; cached no longer than five minutes; returns STALE if upstream fails and a prior verified reading exists.
- `GET /api/history?id=VIDEO_ID`: up to 40 recent timestamped snapshots; VPH is only calculated from two real samples.
- `GET /api/search?q=KEYWORD&region=US&language=en`: official `search.list`, cached 6 hours, distinct search quota, 20 sampled results, not universal rankings or actual search volume.
- `POST /api/admin/track` Bearer `ADMIN_TOKEN` with `{"videoId":"dQw4w9WgXcQ","tier":"high"}`: operator-only track for scheduler.
- Cron `*/5 * * * *`: refresh up to 50 due videos; high every five minutes, normal every fifteen; performs 29-day cleanup.

The Worker does not store public videos or API data for more than 29 days and does not save a visitor's raw IP. Public search/video reads are rate-limited (12/10 minutes per visitor IP hash). Google API key is server-side only. Free-tier request, database read/write and quota ceilings still apply. Scheduled triggers can be delayed and do not mean instant YouTube updates.

## 3. Verification before production

1. `GET /api/status` shows configured Google + bound D1.
2. Live sample public video returns actual counts with `source: REAL PUBLIC` and a timestamp.
3. After a second sample at a later time, VPH is calculated from the snapshot delta; never lifetime average.
4. Search results include query, region, language, last-checked timestamp and position.
5. Blocked API requests return STALE verified data or explicit UNAVAILABLE. Test Google quota errors, 429 and temporary outages.
6. Verify D1 persistence across redeploy, cleanup, rate limits and Worker usage in Cloudflare Dashboard.
7. Have a YouTube API policy/compliance and privacy audit before a public multiuser release.

Official references: [Google granular quota](https://developers.google.com/youtube/data/determine_quota_cost), [batchGetStats](https://developers.google.com/youtube/data/reference/rest/v3/videos/batchGetStats), [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies).
