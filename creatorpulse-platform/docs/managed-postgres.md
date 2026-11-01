# Managed PostgreSQL hosting

The existing Node API supports managed PostgreSQL through `DATABASE_URL`. It uses TLS certificate verification, a three-connection pool, and a separate `creatorpulse` schema. Local development can continue to use SQLite and JSON.

Keep database URLs, API keys, OAuth secrets and `ENCRYPTION_SECRET` only in the hosting provider's secret environment settings. Never commit values to source control.

Production account mode requires `AUTH_MODE=accounts`, `PUBLIC_DEMO=0`, `SECURE_COOKIES=1`, `ALLOW_REGISTRATION=1`, `PERSISTENT_STORAGE_CONFIRMED=1`, `DATABASE_URL`, a stable random `ENCRYPTION_SECRET` of at least 32 characters, and the correct HTTPS `PUBLIC_ORIGIN`.

The existing Render service installs dependencies with `cd creatorpulse-platform && npm install --omit=dev` and starts with `cd creatorpulse-platform && node apps/api/server.mjs`. The committed lockfile fixes dependency versions.

The database holds accounts, hashed sessions and extension tokens, tracking records, ranking observations, encrypted Google refresh tokens, API counters, public-statistics snapshots, owner analytics reports and job results. Runtime state updates use a transaction and row lock. One-time OAuth states and extension codes are consumed with `DELETE ... RETURNING`.

`/admin.html` displays real aggregate records after authentication. Set `ADMIN_USER_IDS` to a comma-separated list of trusted account IDs after verifying account ownership. Email addresses supplied during open registration do not confer administrator access.

Cleanup runs at startup and every six hours while the process is running. It deletes expired credentials and API-derived records older than 29 days. Daily rank checks run when `ENABLE_LIVE_RANK_CHECKS=1`. Free Render services sleep on inactivity, so these in-process schedules are not guaranteed to run while asleep. They are not an always-on worker service.

Neon's Free plan has storage, compute and transfer limits. Keep the organization on Free; do not add billing or enable paid features without owner approval. Render's separate free database belongs to Rolewave and must not be reused or changed for this project.

Google OAuth is configured for external testing. Only registered test users can connect until the owner completes Google's verification and production publishing requirements. Owner analytics also requires the creator's own consent and an eligible channel with available reporting data. Enabling an API does not provide access to another creator's private analytics.

Run `npm test` to verify both the local SQLite adapter and PostgreSQL semantics. The PostgreSQL tests use an isolated PGlite database; production connectivity and persistence must also be verified against the live deployment.
