---
status: authoritative
last-updated: 2026-09-19
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0012 — Log the payload and the status, and nothing else

**Context.** [error handling](../reference/ingest-api.md#error-handling) asked for a structured line carrying `request_id`, `dedupe_key`, outcome, `elapsed_s`, Strava latency, rate-limit headers, `body_bytes`, `content_type`, and `raw_text`. Those eleven fields are discovered at nine different points in the request — auth, body read, parse, lookup, the Strava call, the result write — and Fastify gives a hook no shared place to put them. `app/main.ts` therefore carried a `RequestState` object in a `WeakMap` keyed by the request, seeded in an `onRequest` hook, mutated by the route and the error handler, and serialized by `toRequestLog` in an `onResponse` hook. The machinery existed only to move log fields across hook boundaries, and it had its own failure mode: a missing state meant the hook had not run, which the accessor had to throw on.

The fields were also redundant three ways over. Cloud Run writes its own request log for every invocation, with the response status, wall-clock latency, and request size; `elapsed_s`, `body_bytes`, and the Strava latency were a second, less reliable copy. The outcome, dedupe key, attempt count, and the provider's fault text are all persisted on the workout document, which outlives Cloud Logging's 30-day bucket. What the owner actually reaches for when a share misbehaves is the text Strong sent and the status the service answered with.

**Decision.** The owner decided on 2026-09-19 that the line is `{"status":<code>}` plus the [`raw_text` payload](0011-allow-raw-text-debug-logging.md), which is logged unconditionally, and nothing else. Every other field is dropped. The payload logged is the shared text, not the JSON envelope that may have carried it, so it matches what [persistence](../reference/persistence.md) persists. One route-scoped `onResponse` hook emits it, which replaces the state object, the accessor, the app-level hooks, and the per-outcome logging calls; the route handler went back to throwing a typed `IngestError` and no longer knows that logging exists.

**Consequences.**

- **The outcome is now inferred from the status, and 200 is ambiguous** — a fresh post and a duplicate share look identical in the log. The distinction lives on the Firestore document (`status`, `attempts`) and in the response body the owner already sees on their phone.
- **`request_id` is gone, and with it the id in the 500 response body**, which is now the bare `internal error`. A correlation id that appears in exactly one log line and one response body earns nothing in a single-user service where the payload itself identifies the request. [the ingest API](../reference/ingest-api.md) is amended to match.
- **Rate-limit headers are no longer in this record.** `app/strava.ts` still writes its own plain-text usage lines, which is where a 429 investigation should start.
- **`/health` stops logging.** The hook is scoped to the ingest route, so Cloud Run's health checks no longer produce a constant background of structured lines.
- **[Constraint 3](../CONSTRAINTS.md) and [Constraint 7](../CONSTRAINTS.md) are untouched.** A bad auth emits the bare `{"status":404}` counter with no payload and no request metadata, and every other request logs its `raw_text` per [ADR 0011](0011-allow-raw-text-debug-logging.md).
- **Amends the logging paragraph of [error handling](../reference/ingest-api.md#error-handling) and the 500 row of [the ingest API](../reference/ingest-api.md).** The superseded field list is preserved above as the thing being changed.

→ [Error handling](../reference/ingest-api.md#error-handling) · [Ingest API](../reference/ingest-api.md) · [ADR 0011](0011-allow-raw-text-debug-logging.md)

← [Decisions](README.md) · [Docs index](../README.md)
