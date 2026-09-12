---
status: authoritative
last-updated: 2026-09-10
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0003 — Content-hash guard alongside the share-link slug

**Context.** The primary dedupe key is `strong:{slug}`, taken from the `link.strong.app` URL Strong appends to a share. Whether that slug is stable across repeated shares of the *same* workout is unverified [U] ([open item #2](../planning/11-open-items-and-sources.md)) — if Strong mints a fresh slug per share, dedup silently breaks.

**Decision.** Compute a `content_hash` from `started_at` + exercise names/set-counts on every ingest, store it alongside `dedupe_key`, and check for an existing document with the same `content_hash` before creating a Strava activity, independent of whether the slug matched.

**Consequences.** Correctness no longer depends on resolving the [U] claim about slug stability — it's cheap insurance rather than a blocking investigation. The open item can stay open indefinitely without risk to the idempotency guarantee.

→ [Persistence §6](../planning/04-persistence.md)
