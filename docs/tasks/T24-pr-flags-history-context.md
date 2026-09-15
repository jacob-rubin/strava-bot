---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T24 — Build `HistoryContext` and code-computed PR flags

|            |     |
| ---------- | --- |
| Phase      | [§13 step 5](../planning/10-build-order-and-client.md#13-build-order) — history and PRs |
| Depends on | [T14](T14-activity-text.md), [T23](T23-history-writes.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§6 Data model for activity text](../planning/04-persistence.md#data-model-for-activity-text) — `HistoryContext`, `ExerciseHistory`, and the empty-context rule
- [ADR 0005](../decisions/0005-pr-detection-in-code.md) — PR detection belongs in code
- [Constraint 10](../CONSTRAINTS.md) — never invent data

## Deliverable

- `HistoryContext` assembly from `history` documents, wired into the [T16](T16-ingest-endpoint.md) request path and passed to [T14](T14-activity-text.md)'s deterministic formatter

## Steps

1. Build `ExerciseHistory` per exercise with `best_e1rm`, `best_top_set`, `days_since_last`, and `volume_trend`, honouring the documented nulls — `days_since_last` null when never performed, `volume_trend` null under two data points ([§6](../planning/04-persistence.md#data-model-for-activity-text)).
2. Compute `pr_flags` in code by comparing this workout against the stored history; the formatter consumes the explicit flags without inferring them ([ADR 0005](../decisions/0005-pr-detection-in-code.md)).
3. Leave `per_exercise` and `pr_flags` empty for unseen exercises — the omit-comparative-claims rule applies per exercise, not to the whole call ([§6](../planning/04-persistence.md#data-model-for-activity-text)).
4. Read history before the post and write it after, so a workout never compares against itself.

## Done when

```bash
npm test -- tests/test_activity_text.ts tests/test_ingest.ts -t "history|pr"
```

Passes, covering a true PR setting the flag, a near-miss not setting it, a first-ever exercise producing an empty context with no comparative language in the output, and a `volume_trend` of null with one data point.

## On completion

Flip `T24` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

