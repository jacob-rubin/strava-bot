---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T08 — Write `app/models.ts`

|            |     |
| ---------- | --- |
| Phase      | [§13 step 2](../planning/10-build-order-and-client.md#13-build-order) — parser |
| Depends on | [T04](T04-repo-skeleton.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§6 Data model for `generate()`](../planning/04-persistence.md#data-model-for-generate) — the authoritative shapes for `WorkoutSummary`, `ExerciseSummary`, `HistoryContext`, `ExerciseHistory`
- [§3 Set payload variants](../planning/02-input-contract.md#set-payload-variants) — the `kind` values a `WorkoutSet` must represent
- [Constraint 5](../CONSTRAINTS.md) — `unparsed` is a first-class kind, not an error

## Deliverable

- `app/models.ts` — discriminated-union `WorkoutSet`, `Exercise`, `Workout`, `GeneratedText`, plus the four summary/history types from [§6](../planning/04-persistence.md#data-model-for-generate)
- `tests/test_models.ts` — compile-time shape checks and focused runtime assertions for discriminants and nullable fields

## Steps

1. Define `WorkoutSet` so every variant in [§3](../planning/02-input-contract.md#set-payload-variants) is representable, including `unparsed` with its raw text, the warmup flag from parsing rule 8, and the signed weight of `assisted_reps`.
2. Define `Exercise` and `Workout` to carry the fields [§6 `workouts/{dedupe_key}`](../planning/04-persistence.md#6-persistence) persists under `parsed`.
3. Define `WorkoutSummary`, `ExerciseSummary`, `HistoryContext`, and `ExerciseHistory` exactly as [§6](../planning/04-persistence.md#data-model-for-generate) specifies — these are the only types [T22](T22-llm-provider.md) may see.
4. Define the `GeneratedText` return shape from [§8](../planning/06-llm-generation.md#8-title-and-description-generation).
5. Keep this module dependency-free: no Firestore, no HTTP, no import of `app/strava.ts`. It is imported by `app/llm.ts`, which [Constraint 1](../CONSTRAINTS.md) isolates.

## Done when

```bash
npm run typecheck
npm test -- tests/test_models.ts
```

The module type-checks with no third-party runtime imports, and every field named in [§6](../planning/04-persistence.md#data-model-for-generate) exists with the documented nullability.

## On completion

Flip `T08` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

