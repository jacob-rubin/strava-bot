---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T23 — Add the `history` collection

|            |     |
| ---------- | --- |
| Phase      | [§13 step 5](../planning/10-build-order-and-client.md#13-build-order) — history and PRs |
| Depends on | [T13](T13-store-workouts.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§6 `history/{exercise_name}`](../planning/04-persistence.md#6-persistence) — the document shape and when it is written
- [§6 Data model for activity text](../planning/04-persistence.md#data-model-for-activity-text)

## Deliverable

- `app/store.ts` — `history/{exercise_name}` read and write, written only after a successful post

## Steps

1. Implement the [§6](../planning/04-persistence.md#6-persistence) `history` document: `best_e1rm`, `best_top_set`, `last_performed`, and `recent` capped at the last 10 entries.
2. Write history only after the Strava post succeeds, per [§6](../planning/04-persistence.md#6-persistence) — a failed post must not advance a personal best.
3. Key documents by the base exercise name with equipment stripped, matching [§3 parsing rule 7](../planning/02-input-contract.md#parsing-rules) and the `ExerciseSummary.name` definition in [§6](../planning/04-persistence.md#data-model-for-activity-text).
4. Skip the Strava-taxonomy mapping — [§6](../planning/04-persistence.md#6-persistence) explicitly defers it to Phase 2.

## Done when

```bash
npm test -- tests/test_store.ts -t history
```

Passes, covering a first-time exercise creating a document, a second workout appending to `recent`, `recent` truncating at 10, and no history write when the post failed.

## On completion

Flip `T23` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

