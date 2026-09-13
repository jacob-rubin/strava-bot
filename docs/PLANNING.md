---
status: authoritative
last-updated: 2026-09-13
supersedes: [feasibility-and-architecture.md, ingest-path-design.md, share-sheet-ingest.md, workflow-spec.md]
---

# Strava Bot — Implementation Spec

**Status:** authoritative. Supersedes `feasibility-and-architecture.md`, `ingest-path-design.md`, `share-sheet-ingest.md`, and `workflow-spec.md` in this project.
**Last updated:** 2026-09-12

See also: [CONSTRAINTS.md](CONSTRAINTS.md) (non-negotiable rules, read before editing `app/`), [tasks/](tasks/README.md) (executable task runbooks), [STATUS.md](STATUS.md) (per-task progress), [decisions/](decisions/) (why, not just what), [glossary.md](glossary.md) (domain terms).

The implementation target is strict TypeScript on Node.js 24 LTS ([ADR 0008](decisions/0008-typescript-node-runtime.md)).

Every Strava API claim in this spec is tagged:

- **[V]** — verified against [getting-started](https://developers.strava.com/docs/getting-started/), [reference](https://developers.strava.com/docs/reference/), [authentication](https://developers.strava.com/docs/authentication/), or [rate-limits](https://developers.strava.com/docs/rate-limits/). Build on these.
- **[U]** — unverified or contradicted between sources. **Do not build a required path on a [U] claim.** Probe it at runtime and fall back.

This spec is split into chunks for progressive disclosure. Read the section relevant to what you're doing rather than the whole thing.

## Read by task

Start from the row matching what you're doing instead of the whole spec.

| Task | Read |
| ---- | ---- |
| Parser | [§3](planning/02-input-contract.md), [§12](planning/09-acceptance-criteria.md) |
| Ingest endpoint + auth | [§5](planning/03-ingest-api.md), [§9](planning/07-config-and-repo-layout.md), [ADR 0001](decisions/0001-static-bearer-secret.md) |
| Persistence, dedupe, idempotency | [§6](planning/04-persistence.md), [ADR 0003](decisions/0003-content-hash-dedupe-guard.md) |
| Strava calls + OAuth | [§7](planning/05-strava-integration.md), [ADR 0002](decisions/0002-no-strava-read-scope.md), [ADR 0004](decisions/0004-primary-then-structured-upload.md) |
| LLM title/description | [§8](planning/06-llm-generation.md), [ADR 0005](decisions/0005-pr-detection-in-code.md) |
| Error handling + logging | [§11](planning/08-error-handling.md), [ADR 0006](decisions/0006-no-retry-queue.md) |
| Config, secrets, repo layout | [§9](planning/07-config-and-repo-layout.md) |
| GCP infrastructure (Terraform) | [§5 Deployment](planning/03-ingest-api.md#deployment), [§10 Repository layout](planning/07-config-and-repo-layout.md#10-repository-layout), [ADR 0007](decisions/0007-terraform-for-gcp-infra.md) |
| What to build next | [STATUS.md](STATUS.md), [tasks/](tasks/README.md), [§13](planning/10-build-order-and-client.md) |
| Executing one step | the matching runbook in [tasks/](tasks/README.md) |

Always: [CONSTRAINTS.md](CONSTRAINTS.md) before editing `app/`; [glossary.md](glossary.md) for domain terms.

## Contents

1. [Purpose and prerequisites](planning/01-purpose-and-prerequisites.md) — what this project does, what's explicitly out of scope, and what accounts/access you need before starting.
2. [Input contract — Strong share text](planning/02-input-contract.md) — the exact text format Strong shares, its grammar, parsing rules, set-payload variants, and derived values (volume, duration). Includes the reference parser note.
3. [Ingest API](planning/03-ingest-api.md) — the `POST /ingest/{path_token}` endpoint: auth, processing order, response codes, and Cloud Run deployment via Cloud Build (pipeline in Terraform).
4. [Persistence](planning/04-persistence.md) — Firestore schema for `workouts` (dedupe/idempotency) and `history` (per-exercise rolling state).
5. [Strava integration](planning/05-strava-integration.md) — app setup, OAuth, token refresh, creating activities (primary path + [U] structured-upload path), the AI-training policy constraint, and rate limits.
6. [Title and description generation](planning/06-llm-generation.md) — the LLM `generate()` interface, input/output constraints, and the mandatory deterministic fallback.
7. [Configuration and repository layout](planning/07-config-and-repo-layout.md) — env vars/secrets and the `terraform/`, `app/`, `scripts/`, `tests/` file layout.
8. [Error handling](planning/08-error-handling.md) — the condition → behavior table and logging rules.
9. [Acceptance criteria](planning/09-acceptance-criteria.md) — parser, ingest, boundary, and end-to-end test expectations.
10. [Build order and client](planning/10-build-order-and-client.md) — the 7-step build sequence and the iOS Shortcut setup.
11. [Open items and sources](planning/11-open-items-and-sources.md) — unresolved `[U]` items and how to resolve each, plus the source documents this spec was verified against.

## Execution

[tasks/](tasks/README.md) decomposes the [§13](planning/10-build-order-and-client.md#13-build-order) build order into ~27 atomic task runbooks — one file per task, each naming what to read, what to produce, and a check that proves it done. The runbooks link into this spec rather than restating it. [STATUS.md](STATUS.md) is the single source of truth for which tasks are done.
