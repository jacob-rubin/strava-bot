---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T05 — Write `app/config.py`

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | [T04](T04-repo-skeleton.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — every variable, its source, and its default
- [Constraint 7](../CONSTRAINTS.md) — never log a secret
- [Constraint 8](../CONSTRAINTS.md) — the refresh-token secret must be writable, not just readable

## Deliverable

- `app/config.py` — loads every variable in [§9](../planning/07-config-and-repo-layout.md#9-configuration) from env or Secret Manager, applies the documented defaults, and exposes a write path for the rotated refresh token
- `tests/test_config.py` — defaults and the Secret Manager accessor, with the client stubbed

## Steps

1. Implement one settings object covering every row of [§9](../planning/07-config-and-repo-layout.md#9-configuration), with the documented defaults for `LOCAL_TZ`, `STRAVA_USE_STRUCTURED_UPLOAD`, `MAX_BODY_BYTES`, and `ELAPSED_CAP_S`.
2. Resolve Secret-Manager-sourced values through a single accessor so tests can stub one seam; cache within the process, not across instances.
3. Expose an "add new version" helper for `STRAVA_REFRESH_TOKEN` — [T15](T15-strava-client.md) calls it on rotation.
4. Ensure no `__repr__`, log line, or exception message can emit a secret value.

## Done when

```bash
pytest tests/test_config.py
```

Passes, including a test asserting the four documented defaults and one asserting that repr/str of the settings object contains no secret value.

## On completion

Flip `T05` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

