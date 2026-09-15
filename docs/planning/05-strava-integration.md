---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 7. Strava integration

### 7.1 Application setup — **[V]**

Create the app at `https://www.strava.com/settings/api`. Requires an active Strava subscription. Yields `client_id` and `client_secret`; keep the secret in Secret Manager.

### 7.2 One-time authorization — **[V]**

Run once, manually, as a local script. Not part of the service.

**Step 1** — open in a browser:

```
https://www.strava.com/oauth/authorize
  ?client_id=<CLIENT_ID>
  &response_type=code
  &redirect_uri=http://localhost/exchange_token
  &approval_prompt=force
  &scope=activity:write
```

**Request `scope=activity:write`; an additional returned `read` scope is accepted.** **[V]** `activity:write` grants "access to create manual activities and uploads, and access to edit any activities that are visible to the app." Strava may also grant `read` and report it in the redirect as `scope=read,activity:write`; that is allowed. The service never calls Strava read endpoints, so the broader grant is harmless.

**Step 2** — exchange the `code` from the redirect:

```
POST https://www.strava.com/oauth/token
  client_id, client_secret, code, grant_type=authorization_code
```

Response contains `access_token`, `refresh_token`, `expires_at`, `expires_in` (21600), `token_type`. **Store `refresh_token` in Secret Manager.**

### 7.3 Token refresh — **[V]**

Access tokens expire every 6 hours, so the service refreshes on essentially every invocation.

```
POST https://www.strava.com/api/v3/oauth/token
  client_id, client_secret, grant_type=refresh_token, refresh_token=<current>
```

Response: `token_type`, `access_token`, `expires_at`, `expires_in`, `refresh_token`.

**The response's `refresh_token` may differ from the one sent. Persist it as a new Secret Manager version whenever it changes.** Dropping a rotated refresh token permanently locks the integration out and requires redoing [§7.2](#72-one-time-authorization--v) by hand.

Cache the access token in memory keyed by `expires_at`; refresh when fewer than 300 seconds remain. Do not cache across instances.

### 7.4 Creating the activity

**Primary path — `POST /activities` — [V]**

Fully documented and guaranteed. Build this first; it is the shipping path.

```
POST https://www.strava.com/api/v3/activities
Authorization: Bearer <access_token>

name             (required)  string   ← deterministic title
sport_type       (required)  string   = "WeightTraining"
start_date_local (required)  string   ISO-8601, naive local
elapsed_time     (required)  int      seconds, per §3
description      (optional)  string   ← deterministic description, plain text
trainer          (optional)  int
commute          (optional)  int
```

Returns a `DetailedActivity`; take `id` and build `https://www.strava.com/activities/{id}`.

**`type` is also listed as required in the reference alongside `sport_type`. [U]** Send both — `type="WeightTraining"`, `sport_type="WeightTraining"` — and treat a 400 naming either field as a signal to send only `sport_type`.

Per-set detail lives in the description on this path. Format it as plain text; the field renders no markup.

**Phase 2 — `POST /uploads` with structured sets — [U]**

The changelog dated 2026-05-21 states FIT uploads accept set messages and that a JSON format for weight training accepts structured set data (`set_type`, `start_time`, `duration`, `repetitions`, `weight`, `category`, `category_subtype`). Strava renders these as native per-set detail, which is a materially better result than prose.

**But the reference documents `dataType` as `(fit, tcx, gpx)` only, and third-party mirrors document the field name as `data_type`.** Both the field name and JSON support are unverified.

Implement behind a `STRAVA_USE_STRUCTURED_UPLOAD` flag, default **off**. Probe procedure:

1. `POST /uploads` multipart with a minimal JSON set body, trying `data_type=json` then `dataType=json`.
2. Poll `GET /uploads/{uploadId}` at ≥1s intervals. **[V]** Response fields: `id`, `external_id`, `error`, `status`, `activity_id`. Terminal states are a non-null `error` or a non-null `activity_id`. Mean processing is under 2 seconds; time out at 30s.
3. On any failure, fall back to the primary path in the same request. **A user who taps Share must always get an activity.**

`POST /uploads` also accepts `name` and `description` **[V]**, so the formatted activity text flows through either path unchanged.

Set timestamps: Strong provides none. Distribute sets uniformly across `elapsed_time`; only monotonicity and in-range values matter. `category` / `category_subtype` need the exercise-name mapping deferred in [§6](04-persistence.md) — send null until that exists.

### 7.5 Policy constraint — non-negotiable

Strava API Policy §5.3: _"You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application."_ The clause explicitly extends to grounding, embedding generation, and retrieval-augmented generation.

The MVP has no AI component, provider integration, or model credential. The service remains write-only, so no data originating from Strava can flow to an AI system.

Enforce it in code, not by convention:

1. Request `activity:write`. If Strava also grants `read` (for example the redirect reports `scope=read,activity:write`), accept the authorization, but never call any Strava read endpoint, so no Strava data can be fetched.
2. Keep the MVP free of AI SDKs, remote model calls, prompts, and model credentials ([§8](06-activity-text.md)).
3. Any separately designed post-MVP AI enhancement must never receive a Strava response — including `activity_id`, upload `status`, or error strings.

### 7.6 Rate limits — **[V]**

| Limit      | 15-minute | Daily |
| ---------- | --------- | ----- |
| Overall    | 200       | 2,000 |
| Non-upload | 100       | 1,000 |

The non-upload bucket excludes `POST /activities` and `POST /uploads`. The 15-minute window resets at :00, :15, :30, :45; the daily window at midnight UTC. Exceeding either returns **429**.

Headers, each two comma-separated values (15-minute, daily): `X-RateLimit-Limit`, `X-RateLimit-Usage`, `X-ReadRateLimit-Limit`, `X-ReadRateLimit-Usage`.

Expected volume is ~5 requests/week — limits are irrelevant in practice. Log the usage headers anyway; a runaway retry loop shows up there first. Treat 429 as fatal for the request, respond 502, and do not retry within the same invocation.

---

← [Index](../PLANNING.md) · Previous: [Persistence](04-persistence.md) · Next: [Activity title and description formatting](06-activity-text.md)
