---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T13 — Write `app/store.py` — the `workouts` collection

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T05](T05-config-module.md), [T08](T08-models-module.md), [T11](T11-parser-derived-values.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§6 Persistence](../planning/04-persistence.md#6-persistence) — the `workouts/{dedupe_key}` document shape
- [ADR 0003](../decisions/0003-content-hash-dedupe-guard.md)
- [Constraint 6](../CONSTRAINTS.md) — always persist `raw_text`, even on parse failure
- [Constraint 11](../CONSTRAINTS.md) — no Strava post without a durable idempotency record

## Deliverable

- `app/store.py` — read/write for `workouts`, the dual dedupe lookup, and the post-result update. The `history` collection is [T23](T23-history-writes.md).

## Steps

1. Implement a lookup that checks `workouts/{dedupe_key}` and, on a miss, queries for an existing document with the same `content_hash` — [§6](../planning/04-persistence.md#6-persistence) requires both before any activity is created.
2. Implement the initial write with every field of the [§6](../planning/04-persistence.md#6-persistence) schema, `status="received"`, and `raw_text` populated verbatim — including the parse-failure path, per [Constraint 6](../CONSTRAINTS.md).
3. Implement the terminal update setting `status`, `strava`, `error`, and incrementing `attempts`.
4. Let Firestore errors propagate so [T16](T16-ingest-endpoint.md) can map them to 500 per [§11](../planning/08-error-handling.md#11-error-handling); do not swallow them and do not retry.
5. Never log `raw_text` ([Constraint 7](../CONSTRAINTS.md)).

## Done when

```bash
pytest tests/test_store.py
```

Passes against the Firestore emulator or a stubbed client, covering: fresh write, dedupe-key hit, content-hash hit with a different key, and a parse-failure write that still contains `raw_text`.

## On completion

Flip `T13` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

