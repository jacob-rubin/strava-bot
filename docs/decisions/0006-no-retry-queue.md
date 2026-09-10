---
status: authoritative
last-updated: 2026-09-10
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0006 — No background retry queue

**Context.** Strava calls or LLM calls can fail transiently (429, network blip). A typical service would queue and retry these in the background.

**Decision.** Don't build one. The ingest endpoint is idempotent by construction (dedupe key + content-hash guard, [0003](0003-content-hash-dedupe-guard.md)), and the client is a human tapping Share from their phone. On failure, return an error response and let the user tap Share again.

**Consequences.** Simpler service, no queue infrastructure, no retry-storm risk. This is only sound because volume is ~5 requests/week and the user is present and able to retry immediately — it would not generalize to a multi-user or unattended system.

→ [Error handling §11](../planning/08-error-handling.md)
