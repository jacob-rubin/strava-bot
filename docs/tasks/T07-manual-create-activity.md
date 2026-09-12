---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T07 — Prove `POST /activities` with a manual curl

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | [T06](T06-authorize-script.md) |
| Executor   | human |
| Blocked by | observes [open item 4](../planning/11-open-items-and-sources.md#15-open-items) |

## Read first

- [§7.3 Token refresh](../planning/05-strava-integration.md#73-token-refresh--v) — the refresh call used to mint an access token by hand
- [§7.4 Creating the activity](../planning/05-strava-integration.md#74-creating-the-activity) — the required field set, and the **[U]** `type` / `sport_type` question
- [Open item 4](../planning/11-open-items-and-sources.md#15-open-items)

## Deliverable

No repo change. One real Strava activity created by hand, proving auth and the endpoint before any infrastructure exists — this is the whole point of [§13 step 1](../planning/10-build-order-and-client.md#13-build-order).

## Steps

1. Refresh manually per [§7.3](../planning/05-strava-integration.md#73-token-refresh--v) to obtain an `access_token`.
2. `curl` `POST /activities` with the required fields from [§7.4](../planning/05-strava-integration.md#74-creating-the-activity), sending **both** `type` and `sport_type`, plus a throwaway `name` and `description`.
3. Record whether the call succeeded with both fields, and whether a 400 named either field. That observation resolves [open item 4](../planning/11-open-items-and-sources.md#15-open-items) — write the answer into the STATUS.md open-items row rather than deleting it.
4. Delete the test activity from Strava afterwards.

## Done when

Observable: the `POST` returned `201` with a `DetailedActivity` body, the activity was visible at `https://www.strava.com/activities/{id}`, and open item 4 has a recorded answer in [STATUS.md](../STATUS.md).

## On completion

Flip `T07` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

