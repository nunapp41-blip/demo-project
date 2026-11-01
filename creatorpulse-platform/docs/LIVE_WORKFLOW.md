# CreatorPulse live workflow audit (v1.1)

## Immediately usable without a private API key
- Public YouTube video title and channel through official oEmbed; may be unavailable for unembeddable videos / blocked upstream.
- Latest public channel uploads from YouTube Atom feed, with optional title filter; only feed-supplied views when present.
- Rule-based local title analyzer, server health, and real-time status checks.
- Keyword fallback opens current YouTube search results on YouTube itself (not in-app API results).

## Requires account-owner configuration
- YouTube Data API `YOUTUBE_API_KEY` to retrieve official views, likes, comments, channel statistics and search snapshots via backend.
- Secure durable database + OAuth config to enable multiuser production accounts and owner-authorized retention.
- Payments require merchant keys/approval.

## Verification standard
- Live UI is not equivalent to successful upstream API results. Tests of stubs do not establish production connectivity.
- Do not call this a production-complete product.
