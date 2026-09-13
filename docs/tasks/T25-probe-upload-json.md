---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T25 — Probe `POST /uploads` for JSON structured sets

|            |     |
| ---------- | --- |
| Phase      | [§13 step 7](../planning/10-build-order-and-client.md#13-build-order) — optional structured upload |
| Depends on | [T15](T15-strava-client.md) |
| Executor   | agent |
| Blocked by | resolves [open item 3](../planning/11-open-items-and-sources.md#15-open-items) |

## Read first

- [§7.4 Phase 2 — `POST /uploads`](../planning/05-strava-integration.md#74-creating-the-activity) — the probe procedure and both candidate field names
- [Open item 3](../planning/11-open-items-and-sources.md#15-open-items)
- [ADR 0004](../decisions/0004-primary-then-structured-upload.md)

## Deliverable

- `scripts/probe_upload_json.ts` — one-shot probe, not part of the service
- A recorded answer to open item 3 in [STATUS.md](../STATUS.md)

## Steps

1. Post a minimal JSON set body per [§7.4](../planning/05-strava-integration.md#74-creating-the-activity), trying `data_type=json` first and `dataType=json` second.
2. Poll `GET /uploads/{uploadId}` at ≥1s intervals; terminal states are a non-null `error` or a non-null `activity_id`, with a 30s timeout.
3. Print which field name — if either — was accepted, and delete any activity the probe creates.
4. Record the outcome in the [STATUS.md](../STATUS.md) open-item row. A failure here is a valid result: it keeps [T26](T26-structured-upload.md) unbuilt, which [ADR 0004](../decisions/0004-primary-then-structured-upload.md) treats as the expected default.

## Done when

```bash
npm exec -- tsx scripts/probe_upload_json.ts
```

Exits 0 having printed a definite verdict for both field names, and [STATUS.md](../STATUS.md) open-item row 3 reads `resolved` with that verdict.

## On completion

Flip `T25` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

