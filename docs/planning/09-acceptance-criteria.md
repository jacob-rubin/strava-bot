---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 12. Acceptance criteria

**Parser — against the [§3](02-input-contract.md) fixture:**

- 4 exercises; 12 working sets; 105 total reps; total volume 19,650 lb.
- `Deadlift (Barbell)` → base `Deadlift`, equipment `Barbell`, top set `315 lb × 4`, volume 3,780.
- `Hack Squat` → equipment `null`.
- `Calf Press on Leg Press` → base name unchanged, equipment `null` (no parenthetical).
- `dedupe_key === "strong:gvvdfvga"`.
- `started_at === "2026-09-09T06:43:00"` (naive).

**Parser — variants:**

- `Set W: 135 lb × 8` → `is_warmup=true`, excluded from all totals.
- `Set 1: 12 reps` → `kind="reps"`, `weight=null`.
- `Set 2: +25 lb × 8` → `weight=+25`; `Set 3: -40 lb × 10` → `weight=-40`.
- `Set 1: 1:30` → `duration_s=90`.
- `Set 1: 0.25 mi in 3:10` → `distance=0.25`, `distance_unit="mi"`, `duration_s=190`.
- `Set 2: something weird here` → `kind="unparsed"`, raw retained, no exception.
- A set line using `x` instead of `×` parses identically.

**Ingest:**

- Wrong `X-Ingest-Key` → 404, empty body.
- Wrong `path_token` → 404, empty body.
- 64 KiB + 1 body → 413, no Firestore write.
- Same payload twice → one Strava activity; second response begins `already posted:`.
- Two shares of the same workout with _different_ slugs → still one activity (content-hash guard).
- Unparseable body → 400, and a Firestore doc exists with `raw_text` populated.
- Activity is created with deterministic text containing real workout numbers.
- Strava stubbed to 429 → 502, `status="failed"`, no partial state.

**MVP scope:**

- Activity text formatting is local and deterministic.
- No AI SDK, remote model call, prompt, or model credential is required.

**End-to-end (manual, once):**

- Share a real workout from Strong; the activity appears on Strava with a title and description containing real numbers from that workout.

---

← [Index](../PLANNING.md) · Previous: [Error handling](08-error-handling.md) · Next: [Build order and client](10-build-order-and-client.md)
