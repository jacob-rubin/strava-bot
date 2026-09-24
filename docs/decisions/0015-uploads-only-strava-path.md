---
status: authoritative
last-updated: 2026-09-21
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0015 — `POST /uploads` is the only Strava path

**Supersedes [0004](0004-primary-then-structured-upload.md).**

**Context.** 0004 shipped `POST /activities` first and put the structured upload behind `STRAVA_USE_STRUCTURED_UPLOAD`, defaulting off, because the JSON upload format was unverified [U]. That uncertainty is resolved: `scripts/probe_upload_json.ts` confirmed the accepted shape against the live API, and Strava's uploads documentation now specifies the JSON strength-training schema and its `exercise_type` enum outright.

Carrying both paths costs more than it buys. `POST /activities` can only express per-set detail as description prose, so the fallback silently produces a worse activity than the one the user expected; the two paths need two sets of failure mapping; and `start_date_local`, `trainer`, and `commute` exist only to serve the path being retired.

**Decision.** Delete `POST /activities`, its fallback, and the flag. `POST /uploads` with the structured JSON file is the only way an activity reaches Strava. Every upload failure is fatal for the request: 502, `status="failed"`, and the user taps Share again ([ADR 0006](0006-no-retry-queue.md) still holds — the retry is the user's). A workout that cannot produce a valid file, meaning it has no sets at all, is rejected with 400 before any Strava call rather than being routed around.

**Consequences.** A user who taps Share no longer *always* gets an activity — 0004's central promise is given up on purpose, in exchange for never quietly posting the degraded version. The upload path had never served a live request before this change, since the flag was never set in `terraform/main.tf`, so the first deploy is the first real exercise of it; a live end-to-end check is the release gate, and rollback is a revert and redeploy. Records written before this change keep `strava.method === "activities"`.

→ [Strava integration](../reference/strava.md#creating-the-activity), [Error handling](../reference/ingest-api.md#error-handling)
