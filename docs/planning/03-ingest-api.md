---
status: authoritative
last-updated: 2026-09-10
---

← [Index](../PLANNING.md)

## 5. Ingest API

### `POST /ingest/{path_token}`

**Request**

|              |                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Content-Type | `text/plain; charset=utf-8` (accept `application/json` with `{"text": "..."}` as an alternative) |
| Body         | Strong share text, verbatim, unmodified                                                          |
| Header       | `X-Ingest-Key: <secret>`                                                                         |

**Authentication.** Compare `path_token` and `X-Ingest-Key` against secrets using `hmac.compare_digest`. Failure of either returns **404** with an empty body — do not return 401, do not distinguish which check failed, do not log the supplied values.

Rationale: Shortcuts has no crypto primitives, so OIDC and HMAC request signing are impossible on the client. A static bearer secret is the only option. Blast radius is bounded: the key permits posting workouts to one Strava account and nothing else.

**Processing order is mandatory** — cheap rejections precede all paid work:

1. Auth check → 404
2. `Content-Length` > 64 KiB → 413
3. Parse → 400 with `{"error": "unparseable"}` on failure
4. Idempotency lookup ([§6](04-persistence.md)) → 200 `"already posted: <activity_url>"`
5. Persist raw + parsed
6. LLM call
7. Strava call
8. Persist result

**Responses.** Body is a single plain-text line, ≤200 chars, suitable for display in an iOS notification.

| Status | Body                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 200    | `posted: Deadlift day — 12 sets, 19,650 lb · strava.com/activities/1234567890` |
| 200    | `already posted: strava.com/activities/1234567890`                             |
| 400    | `not a Strong workout`                                                         |
| 413    | `payload too large`                                                            |
| 404    | _(empty)_                                                                      |
| 502    | `strava rejected: <reason>`                                                    |
| 500    | `internal error: <request_id>`                                                 |

### `GET /healthz`

Returns 200 `ok`. Unauthenticated. No dependency checks.

### Deployment

```bash
gcloud run deploy strava-bot \
  --allow-unauthenticated \
  --max-instances=3 \
  --concurrency=4 \
  --memory=512Mi \
  --timeout=120 \
  --set-secrets=INGEST_KEY=strava-bot-ingest-key:latest,\
INGEST_PATH_TOKEN=strava-bot-path-token:latest,\
STRAVA_CLIENT_SECRET=strava-client-secret:latest
```

`--allow-unauthenticated` disables Google's IAM check, not the application's. It is required: the Shortcut cannot mint an OIDC token.

**`--max-instances=3` is a cost control, not a performance setting.** The endpoint is public and invokes a paid model. Also configure a GCP billing budget alert.

---

← [Index](../PLANNING.md) · Previous: [Input contract](02-input-contract.md) · Next: [Persistence](04-persistence.md)
