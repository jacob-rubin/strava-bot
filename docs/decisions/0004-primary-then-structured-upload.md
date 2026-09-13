---
status: authoritative
last-updated: 2026-09-13
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0004 — Ship `POST /activities` first; gate structured uploads behind a flag

**Context.** `POST /activities` (name, sport_type, elapsed_time, description) is fully documented and works today [V]. A separate path — `POST /uploads` with a structured JSON set format — would render much better per-set detail natively on Strava, but both the field name (`data_type` vs `dataType`) and whether JSON upload is supported at all are unverified [U], contradicted between the official reference and third-party mirrors.

**Decision.** Build and ship the primary `POST /activities` path first; it is the thing that must always work. Implement the structured-upload path behind `STRAVA_USE_STRUCTURED_UPLOAD`, default off, and only flip it on after `scripts/probe_upload_json.ts` confirms the behavior against the real API. Any failure on the structured path falls back to the primary path within the same request.

**Consequences.** A user who taps Share always gets an activity, regardless of whether the [U] upload behavior ever pans out. The probe script is disposable scaffolding, not part of the request path.

→ [Strava integration §7.4](../planning/05-strava-integration.md), [Build order §13, step 7](../planning/10-build-order-and-client.md)
