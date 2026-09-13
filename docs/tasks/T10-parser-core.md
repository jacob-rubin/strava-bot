---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T10 — Write `app/parser.ts` — grammar and set variants

|            |     |
| ---------- | --- |
| Phase      | [§13 step 2](../planning/10-build-order-and-client.md#13-build-order) — parser |
| Depends on | [T08](T08-models-module.md), [T09](T09-fixtures.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§3 Grammar](../planning/02-input-contract.md#grammar) and [§3 Parsing rules](../planning/02-input-contract.md#parsing-rules) — all nine rules are binding
- [§3 Set payload variants](../planning/02-input-contract.md#set-payload-variants)
- [§4 Parser module](../planning/02-input-contract.md#4-parser-module) — scope of this module
- [Constraint 5](../CONSTRAINTS.md) — never drop a line

## Deliverable

- `app/parser.ts` — text in, [T08](T08-models-module.md) `Workout` out; structure only, no derived totals (those are [T11](T11-parser-derived-values.md))

## Steps

1. Implement the line classification of [§3 parsing rules](../planning/02-input-contract.md#parsing-rules) 1–5: title line, date line, blank separators, set lines bound to the most recent exercise, share link capture.
2. Accept both `×` and `x` per rule 6, and split trailing parenthetical equipment per rule 7.
3. Mark warmup sets per rule 8, retaining them in the structure.
4. Match the payload variants in [§3](../planning/02-input-contract.md#set-payload-variants) in an order where the more specific pattern wins, and fall through to `kind="unparsed"` with the raw text per rule 9 — never raise on an unknown payload.
5. Fail the parse only on the two mandatory lines of rule 1; a set line before any exercise line is a warning, not a failure.

## Done when

```bash
npm test -- tests/test_parser.ts -t "grammar|variant"
```

Every fixture from [T09](T09-fixtures.md) parses without raising, and the canonical fixture yields 4 exercises with the share slug captured. (Full [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) coverage is [T12](T12-parser-tests.md).)

## On completion

Flip `T10` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

