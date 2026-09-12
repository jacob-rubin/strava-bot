---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T26 — Implement structured upload behind the flag

|            |     |
| ---------- | --- |
| Phase      | [§13 step 7](../planning/10-build-order-and-client.md#13-build-order) — optional structured upload |
| Depends on | [T25](T25-probe-upload-json.md) |
| Executor   | agent |
| Blocked by | only if [T25](T25-probe-upload-json.md) succeeded |

## Read first

- [§7.4 Phase 2](../planning/05-strava-integration.md#74-creating-the-activity) — upload flow, set timestamps, and the null taxonomy fields
- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — `STRAVA_USE_STRUCTURED_UPLOAD` defaults to `false`
- [ADR 0004](../decisions/0004-primary-then-structured-upload.md)
- [§11 Error handling](../planning/08-error-handling.md#11-error-handling) — structured upload failure falls back in the same request

## Deliverable

- `app/strava.py` — `upload_structured()` plus flag-gated dispatch, defaulting off

## Steps

1. Do not start this task unless [T25](T25-probe-upload-json.md) produced a working field name. Building on an unconfirmed **[U]** claim is exactly what [PLANNING.md](../PLANNING.md) forbids.
2. Implement the upload and the poll loop from [§7.4](../planning/05-strava-integration.md#74-creating-the-activity), with the 30s timeout.
3. Distribute set timestamps uniformly across `elapsed_time` — only monotonicity and in-range values matter — and send `category` / `category_subtype` as null until the deferred mapping exists.
4. On any failure, fall back to `create_activity()` within the same request ([§11](../planning/08-error-handling.md#11-error-handling)); a user who taps Share must always get an activity.
5. Keep the flag default `false` in [§9](../planning/07-config-and-repo-layout.md#9-configuration) and enable it only on the deployed service after a successful live run.

## Done when

```bash
pytest tests/test_strava.py -k structured
```

Passes, covering: flag off means `create_activity` is the only call made, upload error falls back to `create_activity` in the same request, and the poll loop times out at 30s into the fallback.

## On completion

Flip `T26` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

