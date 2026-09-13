---
status: authoritative
last-updated: 2026-09-13
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0001 — Static bearer secret instead of OIDC/HMAC

**Context.** The ingest endpoint (`POST /ingest/{path_token}`) must be public (`--allow-unauthenticated`) because the client is an iOS Shortcut, which has no crypto primitives available to sign a request or mint an OIDC token.

**Decision.** Authenticate with two static secrets: the `path_token` (URL segment) and an `X-Ingest-Key` header. Hash supplied and expected values to fixed-length SHA-256 digests, then compare the digests with Node's `crypto.timingSafeEqual`. Both secrets live in Secret Manager server-side and as plaintext in the Shortcut (synced via iCloud). Any failure returns 404 with an empty body, indistinguishable from either check failing.

**Consequences.** Blast radius is bounded — the key only permits posting workouts to one Strava account. Rotation means a new secret version plus editing one field in the Shortcut. The Shortcut itself must never be shared, since the secret is visible in it. See [Constraints #3](../CONSTRAINTS.md).

→ [Ingest API §5](../planning/03-ingest-api.md)
