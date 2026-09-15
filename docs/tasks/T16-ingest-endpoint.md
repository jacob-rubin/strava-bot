---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T16 — Write `app/main.ts` — routes and processing order

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T11](T11-parser-derived-values.md), [T13](T13-store-workouts.md), [T14](T14-activity-text.md), [T15](T15-strava-client.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§5 Ingest API](../planning/03-ingest-api.md#5-ingest-api) — auth, the mandatory processing order, and the response table
- [§11 Error handling](../planning/08-error-handling.md#11-error-handling) — the condition → behaviour table and the logging rule
- [ADR 0001](../decisions/0001-static-bearer-secret.md), [ADR 0006](../decisions/0006-no-retry-queue.md)
- [Constraints 3, 4, 6, 7, 9, 11, 12](../CONSTRAINTS.md)

## Deliverable

- `app/main.ts` — Fastify server with `POST /ingest/{path_token}` and `GET /healthz`, wiring [T11](T11-parser-derived-values.md), [T13](T13-store-workouts.md), [T14](T14-activity-text.md), and [T15](T15-strava-client.md)

## Steps

1. Implement auth exactly as [§5](../planning/03-ingest-api.md#5-ingest-api) specifies: SHA-256 each supplied and expected value, compare the fixed-length digests with `crypto.timingSafeEqual`, return one indistinguishable 404 with an empty body, and log nothing about the supplied values ([Constraint 3](../CONSTRAINTS.md)).
2. Implement the eight processing steps of [§5](../planning/03-ingest-api.md#5-ingest-api) in order, with the size cap rejecting before the body is read ([Constraint 4](../CONSTRAINTS.md)).
3. Accept both `text/plain` and `{"text": "..."}` JSON bodies per [§5](../planning/03-ingest-api.md#5-ingest-api).
4. Call [T14](T14-activity-text.md)'s synchronous local formatter after the durable idempotency record and before the Strava call ([Constraint 9](../CONSTRAINTS.md)).
5. Return exactly the status/body pairs in the [§5](../planning/03-ingest-api.md#5-ingest-api) response table — one plain-text line, ≤200 chars.
6. Emit the single structured log line from [§11](../planning/08-error-handling.md#11-error-handling) per request, with no `raw_text` and no secrets.
7. Add `GET /healthz` returning `ok`, unauthenticated, with no dependency checks.
8. Export a Fastify app factory for `app.inject()` tests, and start the listener only when `app/main.ts` is the process entrypoint.

## Done when

```bash
npm test -- tests/test_ingest.ts -t "order|healthz"
npm run build
PORT=8080 npm start &
curl -s -o /dev/null -w "%{http_code}" localhost:8080/healthz
```

`/healthz` returns 200, and a wrong-key request returns 404 with a zero-length body. (Full [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) ingest coverage is [T17](T17-ingest-tests.md).)

## On completion

Flip `T16` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

