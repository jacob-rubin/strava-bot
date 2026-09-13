---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T17 — `tests/test_ingest.ts` and `tests/test_boundaries.ts`

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T16](T16-ingest-endpoint.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§12 Acceptance criteria](../planning/09-acceptance-criteria.md#12-acceptance-criteria) — the "Ingest" and "Boundaries" bullets
- [§7.5 Policy constraint](../planning/05-strava-integration.md#75-policy-constraint--non-negotiable)
- [Constraint 1](../CONSTRAINTS.md)

## Deliverable

- `tests/test_ingest.ts` — one test per "Ingest" bullet in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria)
- `tests/test_boundaries.ts` — the import-boundary enforcement [Constraint 1](../CONSTRAINTS.md) names

## Steps

1. Cover each [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) ingest bullet: wrong key, wrong path token, oversized body with no Firestore write, double post, two slugs one activity, unparseable body leaving a `raw_text` document, LLM raising yet the activity still created, and Strava 429 → 502 with `status="failed"`.
2. Use the TypeScript compiler API to walk relative imports transitively and assert that `app/llm.ts` has no import path to `app/strava.ts`.
3. Implement the grep-style assertion that no Strava response object is referenced inside `app/llm.ts`.
4. Make `tests/test_boundaries.ts` fail loudly and specifically — it is the only automated enforcement of the [§7.5](../planning/05-strava-integration.md#75-policy-constraint--non-negotiable) policy constraint.

## Done when

```bash
npm run typecheck
npm test
```

The whole suite passes. Then temporarily add an import of `./strava.js` to `app/llm.ts`, confirm `npm test -- tests/test_boundaries.ts` fails, and revert.

## On completion

Flip `T17` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

