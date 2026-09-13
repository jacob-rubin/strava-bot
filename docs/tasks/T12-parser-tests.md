---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T12 — Complete `tests/test_parser.ts` against §12

|            |     |
| ---------- | --- |
| Phase      | [§13 step 2](../planning/10-build-order-and-client.md#13-build-order) — parser |
| Depends on | [T11](T11-parser-derived-values.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§12 Acceptance criteria](../planning/09-acceptance-criteria.md#12-acceptance-criteria) — the parser and variant bullets are the acceptance gate for [§13 step 2](../planning/10-build-order-and-client.md#13-build-order)

## Deliverable

- `tests/test_parser.ts` — one test per bullet under "Parser — against the §3 fixture" and "Parser — variants" in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria)

## Steps

1. Write a test for each fixture bullet: exercise/set/rep/volume counts, the `Deadlift (Barbell)` decomposition and top set, `Hack Squat` equipment `null`, `Calf Press on Leg Press` keeping its base name, the dedupe key, and the naive `started_at` string.
2. Write a test for each variant bullet, including the `x`-vs-`×` equivalence and the `unparsed` retention that must not raise.
3. Assert the numbers from [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) literally; do not recompute expected values from parser output.
4. If a [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) bullet turns out to be wrong, fix the spec in a separate commit rather than weakening the test.

## Done when

```bash
npm test -- tests/test_parser.ts --reporter=verbose
```

All tests pass, and the count of test cases is at least the number of bullets in the two parser sections of [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria).

## On completion

Flip `T12` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

