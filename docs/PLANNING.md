---
status: authoritative
last-updated: 2026-09-10
supersedes: [feasibility-and-architecture.md, ingest-path-design.md, share-sheet-ingest.md, workflow-spec.md]
---

# Strava Bot — Implementation Spec

**Status:** authoritative. Supersedes `feasibility-and-architecture.md`, `ingest-path-design.md`, `share-sheet-ingest.md`, and `workflow-spec.md` in this project.
**Last updated:** 2026-09-10

See also: [CONSTRAINTS.md](CONSTRAINTS.md) (non-negotiable rules, read before editing `app/`), [STATUS.md](STATUS.md) (build progress), [decisions/](decisions/) (why, not just what).

Every Strava API claim in this spec is tagged:

- **[V]** — verified against [getting-started](https://developers.strava.com/docs/getting-started/), [reference](https://developers.strava.com/docs/reference/), [authentication](https://developers.strava.com/docs/authentication/), or [rate-limits](https://developers.strava.com/docs/rate-limits/). Build on these.
- **[U]** — unverified or contradicted between sources. **Do not build a required path on a [U] claim.** Probe it at runtime and fall back.

This spec is split into chunks for progressive disclosure. Read the section relevant to what you're doing rather than the whole thing.

## Contents

1. [Purpose and prerequisites](planning/01-purpose-and-prerequisites.md) — what this project does, what's explicitly out of scope, and what accounts/access you need before starting.
2. [Input contract — Strong share text](planning/02-input-contract.md) — the exact text format Strong shares, its grammar, parsing rules, set-payload variants, and derived values (volume, duration). Includes the reference parser note.
3. [Ingest API](planning/03-ingest-api.md) — the `POST /ingest/{path_token}` endpoint: auth, processing order, response codes, and Cloud Run deployment.
4. [Persistence](planning/04-persistence.md) — Firestore schema for `workouts` (dedupe/idempotency) and `history` (per-exercise rolling state).
5. [Strava integration](planning/05-strava-integration.md) — app setup, OAuth, token refresh, creating activities (primary path + [U] structured-upload path), the AI-training policy constraint, and rate limits.
6. [Title and description generation](planning/06-llm-generation.md) — the LLM `generate()` interface, input/output constraints, and the mandatory deterministic fallback.
7. [Configuration and repository layout](planning/07-config-and-repo-layout.md) — env vars/secrets and the `app/`, `scripts/`, `tests/` file layout.
8. [Error handling](planning/08-error-handling.md) — the condition → behavior table and logging rules.
9. [Acceptance criteria](planning/09-acceptance-criteria.md) — parser, ingest, boundary, and end-to-end test expectations.
10. [Build order and client](planning/10-build-order-and-client.md) — the 7-step build sequence and the iOS Shortcut setup.
11. [Open items and sources](planning/11-open-items-and-sources.md) — unresolved `[U]` items and how to resolve each, plus the source documents this spec was verified against.
