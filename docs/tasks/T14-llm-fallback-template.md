---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T14 — Write `app/llm.py` — signature and deterministic fallback

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T08](T08-models-module.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§8 Title and description generation](../planning/06-llm-generation.md#8-title-and-description-generation) — the `generate()` signature and output constraints
- [Constraint 1](../CONSTRAINTS.md) — this module must not import `app/strava.py` or accept any value it returns
- [Constraint 9](../CONSTRAINTS.md) and [Constraint 10](../CONSTRAINTS.md)

## Deliverable

- `app/llm.py` — the final `generate()` signature from [§8](../planning/06-llm-generation.md#8-title-and-description-generation) plus the deterministic template path only. The provider call is [T22](T22-llm-provider.md); [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) ships templated text.

## Steps

1. Declare `generate()` with exactly the signature in [§8](../planning/06-llm-generation.md#8-title-and-description-generation), taking only [T08](T08-models-module.md) summary/history types.
2. Implement the templated title and description from parsed data alone, honouring the ≤60 / ≤1,000 char limits, plain text, no URLs, no markdown.
3. Reference real numbers from the workout so the output could not read identically for a different workout ([§8](../planning/06-llm-generation.md#8-title-and-description-generation)).
4. Omit comparative claims when the per-exercise history context is empty, per [Constraint 10](../CONSTRAINTS.md) — the rule applies per exercise, not per call.
5. Import nothing from `app.strava`, directly or transitively.

## Done when

```bash
pytest tests/test_llm.py
```

Passes, including a test that two different fixtures produce different descriptions, a test enforcing both length caps, and a test that an empty `HistoryContext` yields no comparative language.

## On completion

Flip `T14` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)
