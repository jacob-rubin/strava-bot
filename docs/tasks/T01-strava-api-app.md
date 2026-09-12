---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T01 — Create the Strava API application

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | — |
| Executor   | human |
| Blocked by | — |

## Read first

- [§2 Prerequisites](../planning/01-purpose-and-prerequisites.md#2-prerequisites)
- [§7.1 Application setup](../planning/05-strava-integration.md#71-application-setup--v)

## Deliverable

No repo change. Out of band: a Strava API application, and its `client_id` / `client_secret` recorded somewhere you can paste from in [T03](T03-secret-manager-secrets.md).

## Steps

1. Confirm the Strava account has an active subscription — [§2](../planning/01-purpose-and-prerequisites.md#2-prerequisites) marks this **[V]** required to create an application at all.
2. Create the application at <https://www.strava.com/settings/api>.
3. Set **Authorization Callback Domain** to `localhost`, as [§7.1](../planning/05-strava-integration.md#71-application-setup--v) requires for the one-time authorization in [T06](T06-authorize-script.md).
4. Copy `client_id` and `client_secret`. Do not commit either; `client_secret` goes to Secret Manager in [T03](T03-secret-manager-secrets.md).

## Done when

Observable: the settings page at <https://www.strava.com/settings/api> shows the application with callback domain `localhost`, and you hold both `client_id` and `client_secret`.

## On completion

Flip `T01` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

