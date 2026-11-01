# Security and compliance notes

**Local development only.** This zero-dependency runtime intentionally binds `127.0.0.1` and has no public internet authentication. Never change HOST to `0.0.0.0` or publish it directly. The tracking API is unauthenticated; production identity, rate limits, authorization and RLS must be implemented first.

- YouTube API key must be set only in server process environment. Never commit `.env`; never put keys inside web pages or extension.
- Validate all user input and escape all values inserted into HTML.
- YouTube scorecards use documented public YouTube endpoints. No page scraping, private endpoint calls or credential harvesting.
- Respect YouTube API data storage, deletion and attribution policies. External policy requirements may change.
- Chrome MV3 only requests YouTube content scripts and local API host permission. No passwords in extension.
- For Retention Doctor, separate Google OAuth for a channel owner will be necessary. Implementation requires OAuth verification and privacy policy.
- Production billing needs signed webhook validation. Payment flows are not present here.
- Current JSON data isn't encrypted or multi-tenant. Use PostgreSQL, backed-up storage and encryption if deploying.
- Disclose that demand proxies, rank snapshots, and outlier calculations are estimates, not official YouTube promises.
