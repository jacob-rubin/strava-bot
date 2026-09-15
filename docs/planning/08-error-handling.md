---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 11. Error handling

| Condition               | Behavior                                                             |
| ------------------------ | ---------------------------------------------------------------------|
| Bad auth                | 404, empty body, nothing logged beyond a counter                     |
| Oversized body          | 413, reject before reading the body                                  |
| Unparseable text        | 400; **still persist `raw_text`** with `status="received"`           |
| Duplicate               | 200 with the existing activity URL; no formatting or Strava call     |
| Strava 401              | Refresh once, retry once, then 502                                   |
| Strava 429              | 502, no retry, log usage headers                                     |
| Strava 4xx (other)      | 502 with the Fault reason; `status="failed"`, `error` recorded       |
| Structured upload fails | Fall back to `POST /activities` in the same request                  |
| Firestore unavailable   | 500. Do **not** post to Strava without a durable idempotency record. |

Retries are the user's job — tapping Share again is idempotent by construction. Do not build a background retry queue.

Log one structured line per request: `request_id`, `dedupe_key`, outcome, `elapsed_s`, Strava latency, rate-limit headers. **Never log `raw_text` or any secret.**

---

← [Index](../PLANNING.md) · Previous: [Configuration and repository layout](07-config-and-repo-layout.md) · Next: [Acceptance criteria](09-acceptance-criteria.md)
