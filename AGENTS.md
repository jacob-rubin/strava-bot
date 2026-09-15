# AGENTS.md

This repo is spec-first: `app/`, `scripts/`, and `tests/` don't exist yet (see [docs/STATUS.md](docs/STATUS.md)). The implementation target is TypeScript on Node.js 24 LTS. The full implementation spec lives under [docs/](docs/), split into small files for progressive disclosure — read only the section relevant to the task at hand, not the whole tree.

## Start here

- [docs/tasks/README.md](docs/tasks/README.md) — executable task runbooks, one per atomic step. This is the entrypoint for doing work: pick a task, read its **Read first** links, run its **Done when** check.
- [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — non-negotiable rules. Read this in full before touching anything under `app/`; it's short by design so an agent can self-check against it in one pass.
- [docs/status/](docs/status/README.md) — the status ledger: one file per task, one per open item. This is the source of truth for progress, and it is what a task branch edits. [docs/STATUS.md](docs/STATUS.md) is the rendered view of it — read it, never edit it.
- [docs/PLANNING.md](docs/PLANNING.md) — index into the full spec at [docs/planning/](docs/planning/), chunked by topic (input contract, ingest API, persistence, Strava integration, activity-text formatting, config/layout, error handling, acceptance criteria, build order). Follow the link for whatever you're implementing; don't load the whole spec into context at once.
- [docs/decisions/](docs/decisions/) — ADRs explaining *why* past choices were made. Check here before revisiting a decision that looks questionable in isolation.
- [docs/glossary.md](docs/glossary.md) — domain terms used across the spec, each pointing at its defining section.

## Working in this repo

- Claims about the Strava API in the spec are tagged `[V]` (verified against Strava's docs) or `[U]` (unverified/contradicted). Never build a required path on a `[U]` claim — probe it at runtime and fall back.
- Use strict TypeScript throughout `app/`, `scripts/`, and `tests/`; do not introduce Python tooling or implementations. Keep persisted Firestore field names in the snake_case forms defined by the spec.
- When asked to create or update a skill, assume the repo-local `.codex/skills/` copy unless the user explicitly requests a global skill. Do not copy repo skills into `$CODEX_HOME/skills` by default.
- Tasks run in parallel, one worktree and branch each. Work out what to do next with `npm run status:next` rather than by reading [docs/STATUS.md](docs/STATUS.md): it reads the ledger from `origin/main` and treats any `codex/<id>-*` branch as a claim on that task.
- Record progress by editing the single file that owns it — `docs/status/tasks/<id>.md` or `docs/status/open-items/<n>.md` — and nothing else. That is what keeps parallel branches from conflicting; see [docs/status/README.md](docs/status/README.md). Task runbooks are static — never record status inside them.
- If a change would violate a rule in [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md), stop and re-read the linked spec section rather than routing around it.
