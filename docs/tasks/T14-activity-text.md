---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)
# T14 — Write `app/activity_text.ts` — deterministic activity text

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T08](T08-models-module.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§8 Activity title and description formatting](../planning/06-activity-text.md#8-activity-title-and-description-formatting) — the formatter signature and output constraints
- [Constraint 9](../CONSTRAINTS.md) and [Constraint 10](../CONSTRAINTS.md)

## Deliverable

- `app/activity_text.ts` — the synchronous deterministic formatter from [§8](../planning/06-activity-text.md#8-activity-title-and-description-formatting)
- `tests/test_activity_text.ts` — focused output and constraint tests

## Steps

1. Implement `formatActivityText()` with exactly the signature in [§8](../planning/06-activity-text.md#8-activity-title-and-description-formatting), taking only [T08](T08-models-module.md) summary/history types.
2. Format the title and description locally from parsed data, honouring the ≤60 / ≤1,000 char limits, plain text, no URLs, no markdown, and no emoji.
3. Reference real numbers from the workout so the output could not read identically for a different workout.
4. Omit comparative claims when the per-exercise history context is empty; use only code-computed PR/comparison flags when it is present.
5. Add no provider SDK, remote call, prompt, credential, timeout, or fallback branch.

## Done when

```bash
npm test -- tests/test_activity_text.ts
```

Passes, including a test that two different fixtures produce different descriptions, a test enforcing both length caps, a determinism test, and a test that an empty `HistoryContext` yields no comparative language.

## On completion

Flip `T14` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)
