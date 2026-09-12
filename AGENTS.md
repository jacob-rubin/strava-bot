# AGENTS.md

This repo is spec-first: `app/`, `scripts/`, and `tests/` don't exist yet (see [docs/STATUS.md](docs/STATUS.md)). The full implementation spec lives under [docs/](docs/), split into small files for progressive disclosure — read only the section relevant to the task at hand, not the whole tree.

## Start here

- [docs/tasks/README.md](docs/tasks/README.md) — executable task runbooks, one per atomic step. This is the entrypoint for doing work: pick a task, read its **Read first** links, run its **Done when** check.
- [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — non-negotiable rules. Read this in full before touching anything under `app/`; it's short by design so an agent can self-check against it in one pass.
- [docs/STATUS.md](docs/STATUS.md) — per-task status and open items; the single source of truth for progress. Check before starting work, update as tasks complete.
- [docs/PLANNING.md](docs/PLANNING.md) — index into the full spec at [docs/planning/](docs/planning/), chunked by topic (input contract, ingest API, persistence, Strava integration, LLM generation, config/layout, error handling, acceptance criteria, build order). Follow the link for whatever you're implementing; don't load the whole spec into context at once.
- [docs/decisions/](docs/decisions/) — ADRs explaining *why* past choices were made. Check here before revisiting a decision that looks questionable in isolation.
- [docs/glossary.md](docs/glossary.md) — domain terms used across the spec, each pointing at its defining section.

## Working in this repo

- Claims about the Strava API in the spec are tagged `[V]` (verified against Strava's docs) or `[U]` (unverified/contradicted). Never build a required path on a `[U]` claim — probe it at runtime and fall back.
- Update [docs/STATUS.md](docs/STATUS.md) as tasks complete or open items resolve; it's expected to change every session, unlike the rest of `docs/`. Task runbooks themselves are static — never record status inside them.
- If a change would violate a rule in [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md), stop and re-read the linked spec section rather than routing around it.
