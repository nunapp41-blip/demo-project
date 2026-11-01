# Architecture and decisions

The handbook recommends a monorepo, Next.js frontend, Fastify REST API, PostgreSQL, Redis/Valkey, worker, MV3 extension, Stripe/Razorpay, and optional AI service. Its MVP prioritizes video scorecard, keyword research, title helper, rank history, multilingual UI, and retention.

## Executable local-first implementation (current)

- `apps/web/public` is a responsive HTML/CSS/JavaScript UI with original assets and zero JavaScript package dependencies. Local demo pages work offline.
- `apps/api/server.mjs` uses Node 22 built-in `node:http`, binds `127.0.0.1:8787`, serves static pages and JSON endpoints on the same origin.
- `apps/api/youtube.mjs` calls the official YouTube Data API when configured with a key held only on the server. Quota/accounting, TTL cache, read-only calls, estimation labels.
- `apps/api/store.mjs` persists tracked keywords, history and local usage counters as JSON via atomic file writes. Multi-user data separation is NOT implemented; do not expose publicly.
- `apps/extension` is an unpacked MV3 service-worker + content-script overlay (Shadow DOM). It calls only the local API, holds no YouTube API keys.
- `packages/shared/scoring.mjs` holds testable formulas used by local server.

## Production transition (not yet complete)

1. Migrate UI to Next.js (App Router), strict TypeScript, Tailwind and shadcn/ui.
2. Move API to Fastify+Zod validation; keep route response shapes unchanged.
3. Swap JSON store for PostgreSQL with per-user RLS and real migrations, not hand-edited tables.
4. Move API cache/job scheduler to Valkey/Redis and BullMQ; daily rank worker, RSS alerts, email notification worker.
5. Add Supabase or equivalent authentication; separate Google YouTube Analytics OAuth with minimal requested scopes. Encrypt refresh tokens at rest. Verify scopes, token refresh and revocation.
6. Implement private owner-only Retention Doctor via YouTube Analytics and timed transcript extraction; not guaranteed transcripts for every video.
7. Implement Stripe/Razorpay billing only after account setup; signed webhooks, proper state-machine, test mode and legal compliance.
8. Add full Hindi localization, consent, GDPR/DPDP processes, policy documents, audit logging, tests and code scanning.
9. Deploy only after rate limiting, identity/authorization, secrets management, monitoring, backups and security review.

## Important design decisions

- Do not misrepresent heuristics as real search volume or a YouTube ranking guarantee.
- Do not scrape YouTube site pages; use documented APIs.
- Core local functionality does not depend on subscription services or Lovable.
- For production, no promise of absolutely free unlimited third-party APIs, compute or hosting.
