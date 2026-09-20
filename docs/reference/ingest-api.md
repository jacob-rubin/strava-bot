# Ingest API

Two routes, implemented in [`app/main.ts`](../../app/main.ts) with the per-step helpers in [`app/ingest/`](../../app/ingest/).

## `POST /ingest/{path_token}`

**Request**

| | |
| --- | --- |
| Content-Type | `text/plain; charset=utf-8`, or `application/json` with `{"text": "..."}` |
| Body | Strong share text, verbatim, unmodified |
| Header | `X-Ingest-Key: <secret>` |

Both content types are parsed as raw strings and the shared text — not the JSON envelope that may have carried it — is what gets persisted and logged.

### Terms

- **path_token** — the secret URL path segment, from the `strava-bot-path-token` secret.
- **X-Ingest-Key** — the static bearer secret header, from the `strava-bot-ingest-key` secret.

Both are checked on every request; a failure of either is indistinguishable in the response.

### Authentication

Each supplied and expected value is hashed to a fixed-length SHA-256 digest and the digests are compared with Node's `crypto.timingSafeEqual` ([`app/util/secret_comparison.ts`](../../app/util/secret_comparison.ts)). `timingSafeEqual` is never called on the raw values, because it throws when their byte lengths differ. Failure of either check returns **404 with an empty body** — never 401, never a message distinguishing which check failed, and never a log line carrying the supplied values ([Constraint 3](../CONSTRAINTS.md)).

Shortcuts has no crypto primitives, so OIDC and HMAC request signing are impossible on the client; a static bearer secret is the only option ([ADR 0001](../decisions/0001-static-bearer-secret.md)). The blast radius is bounded: the key permits posting workouts to one Strava account and nothing else.

### Processing order

Mandatory — cheap rejections precede external writes ([Constraint 4](../CONSTRAINTS.md)):

1. Auth check → 404
2. `Content-Length` over `MAX_BODY_BYTES` (64 KiB) → 413
3. Parse → 400, with `raw_text` persisted anyway
4. Idempotency lookup: `workouts/{dedupe_key}`, then a `content_hash` query ([persistence](persistence.md)) → 200 `already posted`
5. Persist `raw_text` + `parsed` with `status="received"`
6. Read `history/{exercise_name}` for comparative context, before the post, so a workout never compares against itself
7. Format title and description locally ([activity text](activity-text.md))
8. Create the Strava activity ([strava](strava.md))
9. Persist the result and update `history` on success

A previous attempt that ended `failed` is not treated as a completed duplicate: the existing record and its attempt count are reused so that sharing again retries the post.

### Responses

The body is a single plain-text line, short enough to read in an iOS notification.

| Status | Body |
| --- | --- |
| 200 | `posted: Deadlift day — 12 sets, 19,650 lb · strava.com/activities/1234567890` |
| 200 | `already posted: strava.com/activities/1234567890` |
| 400 | `not a Strong workout` |
| 413 | `payload too large` |
| 404 | *(empty)* |
| 502 | `strava rejected: <reason>` |
| 500 | `internal error` |

When Strava does not yield an activity id, the URL is omitted from the line rather than invented ([strava](strava.md#creating-the-activity)).

## `GET /health`

Returns 200 `ok`. Unauthenticated, no dependency checks, and it logs nothing.

Not `/healthz`: Google's frontend answers that path itself on `*.run.app` and never forwards it to the container, so the route would be unreachable once deployed.

## Error handling

| Condition | Behaviour |
| --- | --- |
| Bad auth | 404, empty body, nothing logged beyond a status counter |
| Oversized body | 413, rejected before the body is read |
| Unparseable text | 400; **still persist `raw_text`** with `status="received"` |
| Duplicate | 200 with the existing activity URL; no formatting, no Strava call |
| Strava 401 | Refresh once — re-reading the refresh token from Secret Manager — retry once, then 502 |
| Strava 429 | 502, no retry, usage headers logged |
| Strava 4xx (other) | 502 with the Fault reason; `status="failed"`, `error` recorded |
| Structured upload fails | Fall back to `POST /activities` in the same request |
| Firestore unavailable | 500. Do **not** post to Strava without a durable idempotency record ([Constraint 11](../CONSTRAINTS.md)) |

Retries are the user's job — tapping Share again is idempotent by construction. There is no background retry queue ([ADR 0006](../decisions/0006-no-retry-queue.md)).

## Logging

One line per ingest request, carrying two things: the `status` answered with, and the `raw_text` payload that was shared. There is no flag; the payload is always logged. `raw_text` is omitted rather than emitted as `null`, and a bad auth emits the bare `{"status":404}` counter with no request data at all. `/health` logs nothing.

Everything else is recoverable elsewhere and is deliberately not repeated: latency and request size come from Cloud Run's own request log, and the outcome, dedupe key, attempt count, and provider fault text are all on the workout document in Firestore ([ADR 0012](../decisions/0012-minimal-request-log.md)).

**Never log a secret** — not `INGEST_KEY`, `INGEST_PATH_TOKEN`, the Strava client secret or refresh token, nor any value supplied as one. Logging `raw_text` is permitted and deliberate; [ADR 0011](../decisions/0011-allow-raw-text-debug-logging.md) covers the retention tradeoff that buys.

## Expected behaviour

The executable form is [`tests/test_ingest.ts`](../../tests/test_ingest.ts) plus the per-stage suites in [`tests/`](../../tests/):

- Wrong `X-Ingest-Key` → 404, empty body.
- Wrong `path_token` → 404, empty body.
- 64 KiB + 1 body → 413, no Firestore write.
- Same payload twice → one Strava activity; the second response begins `already posted:`.
- Two shares of the same workout with *different* slugs → still one activity, via the content-hash guard.
- Unparseable body → 400, and a Firestore document exists with `raw_text` populated.
- The activity is created with deterministic text containing real numbers from the workout.
- Strava stubbed to 429 → 502, `status="failed"`, no partial state.

---

← [Docs index](../README.md) · [Persistence](persistence.md) · [Strava](strava.md) · [Operations](../operations.md)

