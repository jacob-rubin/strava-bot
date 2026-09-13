---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T11 — Derived values, dedupe key, content hash, elapsed

|            |     |
| ---------- | --- |
| Phase      | [§13 step 2](../planning/10-build-order-and-client.md#13-build-order) — parser |
| Depends on | [T10](T10-parser-core.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§3 Derived values](../planning/02-input-contract.md#derived-values) and [§3 Duration](../planning/02-input-contract.md#duration)
- [§6 `workouts/{dedupe_key}`](../planning/04-persistence.md#6-persistence) — both derivation rules and `content_hash`
- [ADR 0003](../decisions/0003-content-hash-dedupe-guard.md) — why both keys exist
- [Open item 2](../planning/11-open-items-and-sources.md#15-open-items)

## Deliverable

- Derived-value functions in `app/parser.ts` (or a sibling module): per-set volume, working-set totals, per-exercise top set, `dedupe_key`, `content_hash`, `elapsed_s`

## Steps

1. Compute per-set volume and the three totals per [§3 derived values](../planning/02-input-contract.md#derived-values), counting working sets only and **not** normalizing units.
2. Compute each exercise's top set as the lexicographic max of `(weight, reps)` over working sets.
3. Implement `dedupe_key` with rule 1 then rule 2 from [§6](../planning/04-persistence.md#6-persistence), and always compute `content_hash` alongside it — [ADR 0003](../decisions/0003-content-hash-dedupe-guard.md) makes correctness independent of the **[U]** slug-stability claim.
4. Implement `elapsed_s` with the two-branch formula and the `ELAPSED_CAP_S` bound from [§3 duration](../planning/02-input-contract.md#duration), taking `received_at` as a parameter so tests can pin it.
5. Represent `date_line` as a naive ISO-8601 string per [§3 duration](../planning/02-input-contract.md#duration); do not append an offset or `Z`.

## Done when

```bash
npm test -- tests/test_parser.ts -t "totals|dedupe|elapsed"
```

The canonical fixture yields 12 working sets, 105 reps, 19,650 lb total volume, `dedupe_key === "strong:gvvdfvga"`, and a naive `started_at` of `2026-09-09T06:43:00`.

## On completion

Flip `T11` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

