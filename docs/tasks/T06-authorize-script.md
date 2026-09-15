---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T06 — Write `scripts/authorize.ts` and obtain the refresh token

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | [T03](T03-secret-manager-secrets.md), [T05](T05-config-module.md) |
| Executor   | agent (one human browser step) |
| Blocked by | — |

## Read first

- [§7.2 One-time authorization](../planning/05-strava-integration.md#72-one-time-authorization--v) — the authorize URL, the scope, and the exchange call
- [Constraint 2](../CONSTRAINTS.md) — `activity:write` requested; an additional returned `read` scope is allowed but never used
- [ADR 0009](../decisions/0009-allow-returned-read-scope.md)

## Deliverable

- `scripts/authorize.ts` — prints the authorize URL, accepts the redirect `code`, performs the exchange, and writes the resulting `refresh_token` as a new Secret Manager version
- A populated `STRAVA_REFRESH_TOKEN` secret version

## Steps

1. Build the authorize URL exactly as specified in [§7.2](../planning/05-strava-integration.md#72-one-time-authorization--v), with `scope=activity:write`. If the callback or token response also grants `read` (for example `scope=read,activity:write`), accept it per [Constraint 2](../CONSTRAINTS.md); do not treat it as a failure.
2. **Human step:** open the printed URL, approve, and paste back the `code` from the `localhost` redirect (the redirect will fail to load — only the query string matters).
3. Exchange the code per [§7.2](../planning/05-strava-integration.md#72-one-time-authorization--v) and write `refresh_token` to Secret Manager via the [T05](T05-config-module.md) helper. Print nothing but a success line — no token values.
4. Keep this out of `app/`: [§7.2](../planning/05-strava-integration.md#72-one-time-authorization--v) specifies it is a local script, not part of the service.

## Done when

```bash
npm exec -- tsx scripts/authorize.ts
```

The script exits 0 without printing a token, and the `STRAVA_REFRESH_TOKEN` secret now has a new `enabled` version created just now — the script's own success line confirms the write-back.

## On completion

Flip `T06` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

