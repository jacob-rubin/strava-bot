---
status: authoritative
last-updated: 2026-09-11
---

← [Index](../PLANNING.md) · [Status](../STATUS.md)

# Task runbooks

One file per atomic task: what to read, what to produce, and a check that proves it is done. Each is scoped to a single working session with one verifiable outcome.

**Status is not recorded here.** [STATUS.md](../STATUS.md) is the single source of truth for what is done, in progress, or not started. These files are static spec and are not edited while executing a task.

## How to run a task

1. Open [STATUS.md](../STATUS.md), pick the first task that is not `done` and whose dependencies are all `done`, and flip it to `in progress`.
2. Read [CONSTRAINTS.md](../CONSTRAINTS.md) in full before any task that touches `app/`.
3. Read the task file's **Read first** links. They are the spec; the task file never restates them.
4. Do the **Steps**, then run the **Done when** check.
5. Flip the row in [STATUS.md](../STATUS.md) to `done`, noting any deviation in one line.

Task ids are stable. A task inserted later gets a suffixed id (`T13a`) rather than renumbering the ones after it.

## Tasks

| Task | Phase — [§13](../planning/10-build-order-and-client.md#13-build-order) | Executor | Depends on |
| ---- | ---- | -------- | ---------- |
| [T01 — Create the Strava API application](T01-strava-api-app.md) | 1 prove auth | human | — |
| [T02 — Stand up the GCP project and enable APIs](T02-gcp-project.md) | 1 prove auth | human | — |
| [T03 — Create the Secret Manager secrets](T03-secret-manager-secrets.md) | 1 prove auth | agent | T01, T02 |
| [T04 — Scaffold the repository skeleton](T04-repo-skeleton.md) | 1 prove auth | agent | — |
| [T05 — Write `app/config.py`](T05-config-module.md) | 1 prove auth | agent | T04 |
| [T06 — Write `scripts/authorize.py`](T06-authorize-script.md) | 1 prove auth | agent + human step | T03, T05 |
| [T07 — Prove `POST /activities` with a manual curl](T07-manual-create-activity.md) | 1 prove auth | human | T06 |
| [T08 — Write `app/models.py`](T08-models-module.md) | 2 parser | agent | T04 |
| [T09 — Add the share-text fixtures](T09-fixtures.md) | 2 parser | agent | T04 |
| [T10 — Write `app/parser.py`](T10-parser-core.md) | 2 parser | agent | T08, T09 |
| [T11 — Derived values, dedupe key, elapsed](T11-parser-derived-values.md) | 2 parser | agent | T10 |
| [T12 — Complete `tests/test_parser.py`](T12-parser-tests.md) | 2 parser | agent | T11 |
| [T13 — Write `app/store.py` — `workouts`](T13-store-workouts.md) | 3 ingest v1 | agent | T05, T08, T11 |
| [T14 — Write `app/llm.py` — fallback template](T14-llm-fallback-template.md) | 3 ingest v1 | agent | T08 |
| [T15 — Write `app/strava.py`](T15-strava-client.md) | 3 ingest v1 | agent | T05, T07 |
| [T16 — Write `app/main.py`](T16-ingest-endpoint.md) | 3 ingest v1 | agent | T11, T13, T14, T15 |
| [T17 — Ingest and boundary tests](T17-ingest-and-boundary-tests.md) | 3 ingest v1 | agent | T16 |
| [T18 — `Dockerfile` and a local container run](T18-dockerfile-local-run.md) | 3 ingest v1 | agent | T16 |
| [T19 — Deploy to Cloud Run with a budget alert](T19-cloud-run-deploy.md) | 3 ingest v1 | agent | T03, T17, T18 |
| [T20 — Probe what Strong's share sheet delivers](T20-share-sheet-probe.md) | 4 client | human | — |
| [T21 — Wire the Shortcut and confirm the round trip](T21-shortcut-wiring-e2e.md) | 4 client | human | T19, T20 |
| [T22 — Replace the template with the real LLM path](T22-llm-provider.md) | 5 LLM generation | agent | T14, T19 |
| [T23 — Add the `history` collection](T23-history-writes.md) | 6 history and PRs | agent | T13 |
| [T24 — Build `HistoryContext` and PR flags](T24-pr-flags-history-context.md) | 6 history and PRs | agent | T22, T23 |
| [T25 — Probe `POST /uploads` for JSON sets](T25-probe-upload-json.md) | 7 optional | agent | T15 |
| [T26 — Structured upload behind the flag](T26-structured-upload.md) | 7 optional | agent | T25 |
| [T27 — Write `scripts/reparse.py`](T27-reparse-script.md) | 7 optional tooling | agent | T11, T13 |

[T20](T20-share-sheet-probe.md) has no dependencies and can be run at any time — doing it early de-risks [T21](T21-shortcut-wiring-e2e.md).

---

← [Index](../PLANNING.md) · [Status](../STATUS.md)

