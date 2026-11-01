# Deployment security model (alpha)

- `AUTH_MODE=accounts` enables multi-user scrypt password hashes, SQLite owner-scoped records, hashed 7-day HttpOnly SameSite=Lax session cookies, 30-day revocable extension tokens, one-use 5-minute transfer codes, 10-minute per-IP login throttle, HTTPS secure cookie switch, and explicit Origin protection on state-changing requests.
- Passwords and credential secrets are never logged. Refresh tokens for Google are AES-256-GCM encrypted using ENCRYPTION_SECRET. Do not rotate that secret without a re-encryption migration.
- Multi-tenant record APIs use `user_id` from the authenticated session, never from request JSON. Record IDs alone do not grant access. DB foreign keys/cascades delete sensitive account records.
- `PUBLIC_DEMO=1` denies all private records, registration and AI / Google / payment endpoints. Use this setting for non-durable public preview environments.
- `HOST=0.0.0.0` with real accounts is denied at startup unless operator provides `SECURE_COOKIES=1`, a >=32-character encryption secret and `PERSISTENT_STORAGE_CONFIRMED=1`.
- **The presence of PERSISTENT_STORAGE_CONFIRMED does not validate the disk.** Production operators need a real persistent filesystem or database, backups and documented restores.
- API keys are backend environment only. Google OAuth redirects have single-use state. Stripe/Razorpay webhooks are checked with signed HMAC. Never accept arbitrary client-provided plans or credit card data.
- Official APIs are used instead of prohibited YouTube page scraping. Title heuristics, VPH and outlier scores are labeled; Google Analytics retention is authorized for the channel owner only.
- Before production: implement password reset and email confirmation, account abuse prevention, full rate limiting, anti-CSRF tokens for edge cases, vulnerability review, independent penetration test, encrypted backup recovery, consent records, data export, deletion confirmation and customer-support processes.
- No real user or payment acceptance on free ephemeral hosting. Privacy and terms shipped here are **drafts**, not lawyer-approved documents.
