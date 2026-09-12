---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T16 — Write `app/main.py` — routes and processing order

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T11](T11-parser-derived-values.md), [T13](T13-store-workouts.md), [T14](T14-llm-fallback-template.md), [T15](T15-strava-client.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§5 Ingest API](../planning/03-ingest-api.md#5-ingest-api) — auth, the mandatory processing order, and the response table
- [§11 Error handling](../planning/08-error-handling.md#11-error-handling) — the condition → behaviour table and the logging rule
- [ADR 0001](../decisions/0001-static-bearer-secret.md), [ADR 0006](../decisions/0006-no-retry-queue.md)
- [Constraints 3, 4, 6, 7, 9, 11, 12](../CONSTRAINTS.md)

## Deliverable

- `app/main.py` — `POST /ingest/{path_token}` and `GET /healthz`, wiring [T11](T11-parser-derived-values.md), [T13](T13-store-workouts.md), [T14](T14-llm-fallback-template.md), and [T15](T15-strava-client.md)

## Steps

1. Implement auth exactly as [§5](../planning/03-ingest-api.md#5-ingest-api) specifies: `hmac.compare_digest` on both the path token and the header, one indistinguishable 404 with an empty body, nothing logged about the supplied values ([Constraint 3](../CONSTRAINTS.md)).
2. Implement the eight processing steps of [§5](../planning/03-ingest-api.md#5-ingest-api) in order, with the size cap rejecting before the body is read ([Constraint 4](../CONSTRAINTS.md)).
3. Accept both `text/plain` and `{"text": "..."}` JSON bodies per [§5](../planning/03-ingest-api.md#5-ingest-api).
4. Wrap the [T14](T14-llm-fallback-template.md) call so any error or a 10s timeout falls back to the template and still posts ([Constraint 9](../CONSTRAINTS.md)).
5. Return exactly the status/body pairs in the [§5](../planning/03-ingest-api.md#5-ingest-api) response table — one plain-text line, ≤200 chars.
6. Emit the single structured log line from [§11](../planning/08-error-handling.md#11-error-handling) per request, with no `raw_text` and no secrets.
7. Add `GET /healthz` returning `ok`, unauthenticated, with no dependency checks.

## Done when

```bash
pytest tests/test_ingest.py -k "order or healthz"
uvicorn app.main:app --port 8080 &
curl -s -o /dev/null -w "%{http_code}" localhost:8080/healthz
```

`/healthz` returns 200, and a wrong-key request returns 404 with a zero-length body. (Full [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) ingest coverage is [T17](T17-ingest-and-boundary-tests.md).)

## On completion

Flip `T16` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

