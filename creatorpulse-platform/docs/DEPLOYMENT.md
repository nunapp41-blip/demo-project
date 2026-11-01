# Deploying CreatorPulse safely

1. **Public preview:** static site on free Render hosting or Node web service with `PUBLIC_DEMO=1`; read-only demo, no user signup or payment collection. The app's `index.html` and `landing.html` remain accessible.
2. **Self-hosted local accounts:** run `AUTH_MODE=accounts ALLOW_REGISTRATION=1 ENCRYPTION_SECRET=<strong-secret> node apps/api/server.mjs` on your own computer; open `http://127.0.0.1:8787/#settings`. Data is in `data/creators.sqlite`, with WAL enabled. Never put the encryption secret in git.
3. **Actual hosted user accounts:** use a platform with a persistent disk or a durable managed database, a verified HTTPS domain, secure cookies, reliable backups and secrets. Provision the infrastructure before using `PERSISTENT_STORAGE_CONFIRMED=1`; do not set this flag on an ephemeral free service.
4. **Google Cloud:** create YouTube Data API v3 key and owner OAuth credentials; activate YouTube Analytics API; set accurate redirect URI, app domain and support contacts. Obtain necessary Google verification/consent review.
5. **Paid plans:** create merchant account, subscription price IDs and corresponding webhook secrets. First test a small complete transaction and cancellation/refund flow in sandbox. Razorpay checkout/reconciliation is not ready.
6. **Chrome Web Store:** validate in actual Chrome with a test creator account, add disclosure/screenshots/privacy policy and submit. Until then use Load unpacked locally.
7. **Release validation:** `npm test`, `npm run check`, cross-browser manual tests, backup restore, integration tests against live services with test accounts, quota exhaustion, error logs, legal review.

**Operational note:** Zero paid developer subscriptions does not mean unlimited production infrastructure, API access, domains or merchant processing are free.
