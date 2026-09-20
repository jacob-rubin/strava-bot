# Strava integration

Implemented in [`app/strava.ts`](../../app/strava.ts); the one-time authorization lives in [`scripts/authorize.ts`](../../scripts/authorize.ts).

## Application setup

The app is created at `https://www.strava.com/settings/api` and needs an active Strava subscription. It yields `client_id` (plain env var) and `client_secret` (Secret Manager). The Authorization Callback Domain is `localhost`, for the one-time authorization only.

## One-time authorization

Run once, by hand, as a local script — not part of the service. See [operations](../operations.md#authorizing-strava) for the procedure.

**Step 1** — open in a browser:

```
https://www.strava.com/oauth/authorize
  ?client_id=<CLIENT_ID>
  &response_type=code
  &redirect_uri=http://localhost/exchange_token
  &approval_prompt=force
  &scope=activity:write
```

The authorization request asks for `activity:write` and nothing broader. `activity:write` grants "access to create manual activities and uploads, and access to edit any activities that are visible to the app." Strava may additionally grant `read` and report it in the redirect as `scope=read,activity:write`; that grant is accepted, and a granted `read` scope may be used ([ADR 0009](../decisions/0009-allow-returned-read-scope.md), [ADR 0010](../decisions/0010-allow-development-read-calls.md)).

**Step 2** — exchange the `code` from the redirect:

```
POST https://www.strava.com/oauth/token
  client_id, client_secret, code, grant_type=authorization_code
```

The response contains `access_token`, `refresh_token`, `expires_at`, `expires_in` (21600), and `token_type`. The `refresh_token` is stored as a Secret Manager version.

## Token refresh and rotation

Access tokens expire every 6 hours, so the service refreshes on essentially every invocation:

```
POST https://www.strava.com/api/v3/oauth/token
  client_id, client_secret, grant_type=refresh_token, refresh_token=<current>
```

**The response's `refresh_token` may differ from the one sent, and a changed value is written immediately as a new Secret Manager version** ([Constraint 8](../CONSTRAINTS.md)). Dropping a rotated refresh token locks the integration out permanently and forces a manual re-authorization.

The access token is cached in memory keyed by `expires_at` and refreshed when fewer than 300 seconds remain. The cache is per instance and never shared. After a 401 the client forces a refresh and re-reads `strava-refresh-token` from Secret Manager, bypassing its own cache, so an instance whose token another instance has superseded recovers without being replaced; the failed call is then retried exactly once.

## Creating the activity

The shipping path is `POST /activities`:

```
POST https://www.strava.com/api/v3/activities
Authorization: Bearer <access_token>

name             (required)  string   ← deterministic title
sport_type       (required)  string   = "WeightTraining"
type             (required)  string   = "WeightTraining"
start_date_local (required)  string   ISO-8601, naive local
elapsed_time     (required)  int      seconds
description      (optional)  string   ← deterministic description, plain text
trainer          (optional)  int
commute          (optional)  int
```

Sending `type` alongside `sport_type` is accepted: two consecutive creates returned 201, neither with a 400 naming either field. Both are sent.

**The success body is not reliable.** The reference documents a `DetailedActivity` return, but 201 with a zero-byte body has been observed on creates that succeeded, with the sent `name`, `description`, and `elapsed_time` all rendering correctly on the activity page. The id is therefore recovered in this order: `id` from the response body, else an `/activities/{id}` suffix on the `Location` response header, else nothing — in which case `id` and `url` are both null and the response line simply omits the link. The request is never retried to chase a missing body; that would create a duplicate activity.

Per-set detail lives in the description on this path, formatted as plain text, because the field renders no markup.

## Structured uploads

Behind the `STRAVA_USE_STRUCTURED_UPLOAD` flag, default **off**. When enabled, the service posts the sets to `POST /uploads` so Strava renders native per-set detail, and falls back to `POST /activities` in the same request on any failure — a user who taps Share always gets an activity.

The accepted shape was established by [`scripts/probe_upload_json.ts`](../../scripts/probe_upload_json.ts) against the live API:

- The field is `data_type` with the value `json`. `dataType=json` is rejected at intake with a 400 naming the data-type field.
- The uploaded file is a JSON envelope: `version` `"1.0"`, `start_time`, `utc_offset`, `elapsed_time`, and a non-empty `sets` array whose members use `exercise_type` — not the `set_type` / `category` field names documented for the FIT set message.
- The multipart form also carries `name`, `description`, and `activity_type=WeightTraining`, so the formatted activity text flows through either path unchanged.
- Weights are converted to kilograms for the upload; nothing else normalizes units.
- Strong supplies no set timestamps, so sets are distributed uniformly across `elapsed_time` in source order — only monotonicity and in-range values matter.
- `category` and `category_subtype` are sent as null, because the exercise-name taxonomy mapping does not exist and must not be guessed from a name.

Intake returns an upload id, which is then polled at `GET /uploads/{uploadId}` every second until a terminal state — a non-null `error` or a non-null `activity_id` — or a 30-second timeout. A 401 mid-poll refreshes and retries the poll once.

One caveat from the probe: an activity created this way returned 404 on API `GET` and `DELETE` with a `read,activity:write` token, so an activity invisible to the app's scope cannot be removed via the API and needs deleting by hand on strava.com.

## Policy constraint

Strava API Policy §5.3: *"You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application."* The clause explicitly extends to grounding, embedding generation, and retrieval-augmented generation.

The service has no AI component, provider integration, or model credential, which is what makes §5.3 inapplicable. The service is **not** structurally write-only ([ADR 0010](../decisions/0010-allow-development-read-calls.md)), so "Strava data cannot be fetched" is not an argument this design can make — the absence of any AI component is the whole of the compliance story.

1. Request `activity:write` and nothing broader. Read endpoints may be called, so rules 2 and 3 carry the policy rather than the request shape. A read payload must also stay out of an AI coding agent's context: write it to a gitignored file and quote only what is needed.
2. Keep the service free of AI SDKs, remote model calls, prompts, and model credentials ([activity text](activity-text.md)).
3. Any separately designed enhancement must never receive a Strava response — including `activity_id`, upload `status`, or error strings.

## Rate limits

| Limit | 15-minute | Daily |
| --- | --- | --- |
| Overall | 200 | 2,000 |
| Non-upload | 100 | 1,000 |

The non-upload bucket excludes `POST /activities` and `POST /uploads`. The 15-minute window resets at :00, :15, :30, :45; the daily window at midnight UTC. Exceeding either returns **429**, which is fatal for the request: the service answers 502 and does not retry within the same invocation.

Every Strava call logs the usage headers — `X-RateLimit-Limit`, `X-RateLimit-Usage`, `X-ReadRateLimit-Limit`, `X-ReadRateLimit-Usage`, each two comma-separated values (15-minute, daily). At roughly five requests a week the limits are irrelevant in practice; the headers are logged because a runaway retry loop shows up there first.

## Sources

- [Getting Started](https://developers.strava.com/docs/getting-started/) — app setup, authorize/token URLs, token lifetime, rate limits
- [API Reference](https://developers.strava.com/docs/reference/) — createActivity, createUpload, getUploadById, Upload object, Fault
- [Authentication](https://developers.strava.com/docs/authentication/) — scope definitions, refresh request
- [Rate Limits](https://developers.strava.com/docs/rate-limits/) — buckets, headers, 429
- [Uploads](https://developers.strava.com/docs/uploads/) — async processing, polling interval, the JSON strength-training format
- [API Changelog](https://developers.strava.com/docs/changelog/) — 2026-05-21 structured set data; 2026-06-01 tier changes
- [API Policy](https://www.strava.com/legal/api_policy) — §5.3

---

← [Docs index](../README.md) · [Ingest API](ingest-api.md) · [Operations](../operations.md)

