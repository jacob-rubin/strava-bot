---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)
# T17 — Complete `tests/test_ingest.ts`

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T16](T16-ingest-endpoint.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§12 Acceptance criteria](../planning/09-acceptance-criteria.md#12-acceptance-criteria) — the ingest bullets
- [§7.5 Policy constraint](../planning/05-strava-integration.md#75-policy-constraint--non-negotiable)
- [Constraints 1, 3, 4, 6, 7, 11, 12](../CONSTRAINTS.md)

## Deliverable

- `tests/test_ingest.ts` — one test per ingest bullet in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria)

## Steps

1. Cover each ingest bullet: wrong key, wrong path token, oversized body with no Firestore write, double post, two slugs one activity, unparseable body leaving a `raw_text` document, deterministic activity text reaching Strava, and Strava 429 → 502 with `status="failed"`.
2. Stub Firestore and Strava at their module boundaries; the deterministic formatter requires no external-service stub.
3. Assert that the request path performs no model/provider call and requires no model credential.

## Done when

```bash
npm run typecheck
npm test
```

The whole suite passes, and the ingest tests demonstrate that the complete MVP request path works with only Firestore and Strava as external services.

## On completion

Flip `T17` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)
