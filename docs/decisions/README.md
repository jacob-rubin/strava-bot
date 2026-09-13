---
status: authoritative
last-updated: 2026-09-13
---

← [Index](../PLANNING.md)

# Decisions

Short records of choices in [PLANNING.md](../PLANNING.md) that trade something off, so the reasoning survives independently of the paragraph it happens to sit in. Add a new numbered file when a future change reopens one of these or introduces a comparable trade-off — don't edit history, supersede it and link back.

- [0001](0001-static-bearer-secret.md) — Static bearer secret instead of OIDC/HMAC for the ingest endpoint
- [0002](0002-no-strava-read-scope.md) — Request `activity:write` only, no read scope
- [0003](0003-content-hash-dedupe-guard.md) — Content-hash guard alongside the share-link slug for dedup
- [0004](0004-primary-then-structured-upload.md) — Ship `POST /activities` first; gate structured uploads behind a flag
- [0005](0005-pr-detection-in-code.md) — PR detection computed in code, not left to the model
- [0006](0006-no-retry-queue.md) — No background retry queue; retries are the user tapping Share again
- [0007](0007-terraform-for-gcp-infra.md) — Terraform for GCP infrastructure; Cloud Build (buildpacks) deploys Cloud Run
- [0008](0008-typescript-node-runtime.md) — TypeScript on Node.js 24 LTS for the service, scripts, and tests

← [Index](../PLANNING.md)
