---
status: living-document
last-updated: 2026-09-13
---

← [Index](PLANNING.md) · [Task runbooks](tasks/README.md)

# Build status

**Current focus:** [T05 — Write `app/config.ts`](tasks/T05-config-module.md). T04 established the Node.js 24 LTS and strict TypeScript scaffold; T05 is the earliest unfinished task whose dependencies are now complete.

This file is the **single source of truth for task status**. Task runbooks in [tasks/](tasks/README.md) are static; they carry no status of their own. Unlike the rest of `docs/`, this file is expected to change every work session — update it as tasks complete instead of inferring progress from the code or git log.

Status values: `not started` · `in progress` · `done` · `blocked` · `skipped`.

## Tasks

| ID | Task | Phase — [§13](planning/10-build-order-and-client.md#13-build-order) | Executor | Status | Notes |
| -- | ---- | ----- | -------- | ------ | ----- |
| T01 | [Create the Strava API application](tasks/T01-strava-api-app.md) | 1 prove auth | human | done | `client_id` 278290; secret in a git-ignored `.env` pending T03. Added `.gitignore` (T04's deliverable) early to cover it |
| T02 | [Stand up the GCP project with Terraform](tasks/T02-gcp-project.md) | 1 prove auth | agent + human step | done | Project `strava-bot-508419` (`us-central1`), imported rather than created — it already existed. State is remote in `gs://strava-bot-508419-tfstate`, the one resource made with `gcloud` ([ADR 0007](decisions/0007-terraform-for-gcp-infra.md) amended). T19's budget landed early; `storage`/`cloudbilling`/`billingbudgets`/`cloudresourcemanager` enabled beyond the runbook's five APIs |
| T03 | [Create the Secret Manager secrets with Terraform](tasks/T03-secret-manager-secrets.md) | 1 prove auth | agent | done | Secret resources and IAM landed early in T02, so this added the versions: `INGEST_KEY`/`INGEST_PATH_TOKEN` from `random_password` (43 URL-safe chars, ~256 bits), `STRAVA_CLIENT_SECRET` from `TF_VAR_strava_client_secret`. The premature `llm-api-key` resource was removed during T05; provider-specific configuration is deferred to [T22](tasks/T22-llm-provider.md). The refresh token waits for T06 |
| T04 | [Scaffold the TypeScript repository skeleton](tasks/T04-repo-skeleton.md) | 1 prove auth | agent | done | Node.js 24 LTS + strict TypeScript scaffold implemented per [ADR 0008](decisions/0008-typescript-node-runtime.md) |
| T05 | [Write `app/config.ts`](tasks/T05-config-module.md) | 1 prove auth | agent | in progress | |
| T06 | [Write `scripts/authorize.ts`](tasks/T06-authorize-script.md) | 1 prove auth | agent + human step | not started | |
| T07 | [Prove `POST /activities` with a manual curl](tasks/T07-manual-create-activity.md) | 1 prove auth | human | not started | observes open item 4 |
| T08 | [Write `app/models.ts`](tasks/T08-models-module.md) | 2 parser | agent | not started | |
| T09 | [Add the share-text fixtures](tasks/T09-fixtures.md) | 2 parser | agent | not started | |
| T10 | [Write `app/parser.ts`](tasks/T10-parser-core.md) | 2 parser | agent | not started | |
| T11 | [Derived values, dedupe key, elapsed](tasks/T11-parser-derived-values.md) | 2 parser | agent | not started | |
| T12 | [Complete `tests/test_parser.ts`](tasks/T12-parser-tests.md) | 2 parser | agent | not started | |
| T13 | [Write `app/store.ts` — `workouts`](tasks/T13-store-workouts.md) | 3 ingest v1 | agent | not started | |
| T14 | [Write `app/llm.ts` — fallback template](tasks/T14-llm-fallback-template.md) | 3 ingest v1 | agent | not started | |
| T15 | [Write `app/strava.ts`](tasks/T15-strava-client.md) | 3 ingest v1 | agent | not started | |
| T16 | [Write `app/main.ts`](tasks/T16-ingest-endpoint.md) | 3 ingest v1 | agent | not started | |
| T17 | [Ingest and boundary tests](tasks/T17-ingest-and-boundary-tests.md) | 3 ingest v1 | agent | not started | |
| T18 | [Buildpacks build and local run](tasks/T18-dockerfile-local-run.md) | 3 ingest v1 | agent | not started | |
| T19 | [Deploy to Cloud Run via Cloud Build with a budget alert](tasks/T19-cloud-run-deploy.md) | 3 ingest v1 | agent | not started | Step 3 done early in T02 — `google_billing_budget` applied at 10 USD/month (50/90/100% actual, 100% forecast). Only the Cloud Build trigger and the deploy remain |
| T20 | [Probe what Strong's share sheet delivers](tasks/T20-share-sheet-probe.md) | 4 client | human | not started | resolves open item 1; no dependencies, run early |
| T21 | [Wire the Shortcut and confirm the round trip](tasks/T21-shortcut-wiring-e2e.md) | 4 client | human | not started | needs open item 1 resolved |
| T22 | [Replace the template with the real LLM path](tasks/T22-llm-provider.md) | 5 LLM generation | agent | not started | |
| T23 | [Add the `history` collection](tasks/T23-history-writes.md) | 6 history and PRs | agent | not started | |
| T24 | [Build `HistoryContext` and PR flags](tasks/T24-pr-flags-history-context.md) | 6 history and PRs | agent | not started | |
| T25 | [Probe `POST /uploads` for JSON sets](tasks/T25-probe-upload-json.md) | 7 optional | agent | not started | resolves open item 3 |
| T26 | [Structured upload behind the flag](tasks/T26-structured-upload.md) | 7 optional | agent | not started | only if T25 succeeds |
| T27 | [Write `scripts/reparse.ts`](tasks/T27-reparse-script.md) | 7 optional tooling | agent | not started | |

Dependencies live in [tasks/README.md](tasks/README.md) and in each task's header; they are not duplicated here.

## Open items

| # | Item | Status | Resolved by |
| - | ---- | ------ | ----------- |
| 1 | Does the share sheet deliver full text or only the URL? | unresolved — blocks T21 | [T20](tasks/T20-share-sheet-probe.md) |
| 2 | Is the `link.strong.app` slug stable across shares? | unresolved — non-blocking, content-hash guard covers it either way | [T20](tasks/T20-share-sheet-probe.md), incidentally |
| 3 | Does `POST /uploads` accept JSON; is the field `data_type` or `dataType`? | unresolved — blocks T26 only | [T25](tasks/T25-probe-upload-json.md) |
| 4 | Does `POST /activities` require `type` alongside `sport_type`? | unresolved — non-blocking, spec says send both | [T07](tasks/T07-manual-create-activity.md) |
| 5 | Set-format coverage beyond the six known variants | ongoing — non-blocking, `unparsed` retains anything new | [T27](tasks/T27-reparse-script.md), continuously |

## How to update this file

- Flip a task's **Status** as work starts and finishes. Add a one-line note in the row if the work deviated from the spec.
- Update **Current focus** to the next task whose dependencies are all `done`.
- Flip an open item to `resolved` and record the answer inline (e.g. "share sheet delivers full text — confirmed via Quick Look, 2026-09-XX") rather than deleting the row; [planning/11-open-items-and-sources.md](planning/11-open-items-and-sources.md)'s §15 stays the historical record of what was in question.
- Add a task with a suffixed id (`T13a`) rather than renumbering; add its runbook to [tasks/](tasks/README.md) and its row here and in [tasks/README.md](tasks/README.md).
- Bump `last-updated` whenever this file changes.

---

← [Index](PLANNING.md) · [Task runbooks](tasks/README.md)

