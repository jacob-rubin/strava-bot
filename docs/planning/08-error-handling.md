---
status: authoritative
last-updated: 2026-09-19
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

Log one line per ingest request, carrying two things: the `status` it answered with, and the `raw_text` payload that was shared when `DEBUG_LOG_RAW_TEXT` is enabled (it defaults to `true`). Log the shared text, not the JSON envelope that may have carried it. Omit `raw_text` rather than emitting it as `null`, and emit the bare `{"status":404}` counter for a bad auth — §11 allows that case no request data at all. `/health` logs nothing.

Everything else is recoverable elsewhere and is deliberately not repeated here: latency and request size come from Cloud Run's own request log, and the outcome, dedupe key, attempt count, and the provider's fault text are all on the workout document in Firestore ([ADR 0012](../decisions/0012-minimal-request-log.md)).

**Never log a secret** — not `INGEST_KEY`, `INGEST_PATH_TOKEN`, the Strava client secret or refresh token, nor any value supplied as one. An auth failure still emits a bare counter and nothing else. Logging `raw_text` is permitted and deliberate; see [ADR 0011](../decisions/0011-allow-raw-text-debug-logging.md) for the retention tradeoff that buys.

---

← [Index](../PLANNING.md) · Previous: [Configuration and repository layout](07-config-and-repo-layout.md) · Next: [Acceptance criteria](09-acceptance-criteria.md)
