---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T15 — Write `app/strava.py` — refresh, rotation, create activity

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T05](T05-config-module.md), [T07](T07-manual-create-activity.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§7.3 Token refresh](../planning/05-strava-integration.md#73-token-refresh--v) — caching rule and the rotation requirement
- [§7.4 Creating the activity](../planning/05-strava-integration.md#74-creating-the-activity) — primary path field set
- [§7.6 Rate limits](../planning/05-strava-integration.md#76-rate-limits--v) and [§11](../planning/08-error-handling.md#11-error-handling) — 401/429/4xx behaviour
- [Constraint 8](../CONSTRAINTS.md) — persist a rotated refresh token immediately

## Deliverable

- `app/strava.py` — token refresh with in-memory caching and write-back, plus `create_activity()` on the primary path. The **[U]** structured upload is [T26](T26-structured-upload.md).

## Steps

1. Implement refresh per [§7.3](../planning/05-strava-integration.md#73-token-refresh--v), caching the access token in memory keyed by `expires_at` and refreshing under 300s remaining.
2. Whenever the response's `refresh_token` differs from the one sent, write a new Secret Manager version via [T05](T05-config-module.md) before proceeding — [Constraint 8](../CONSTRAINTS.md); losing it forces redoing [T06](T06-authorize-script.md) by hand.
3. Implement `create_activity()` with the required fields from [§7.4](../planning/05-strava-integration.md#74-creating-the-activity), sending both `type` and `sport_type` unless [T07](T07-manual-create-activity.md) recorded otherwise in [STATUS.md](../STATUS.md), and return the `id` plus the built activity URL.
4. Map failures as [§11](../planning/08-error-handling.md#11-error-handling) specifies: 401 → refresh once and retry once then fail; 429 → fail immediately with the usage headers logged; other 4xx → fail with the Fault reason. No retry loops ([Constraint 12](../CONSTRAINTS.md)).
5. Log the [§7.6](../planning/05-strava-integration.md#76-rate-limits--v) usage headers on every call.

## Done when

```bash
pytest tests/test_strava.py
```

Passes with the HTTP layer stubbed, covering: cached token reuse, refresh under the 300s threshold, a rotated refresh token triggering exactly one secret write, 401-then-retry-once, and 429 raising without a retry.

## On completion

Flip `T15` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

