# AGENTS.md

A deployed single-user service: Strong share text in, Strava activity out. Strict TypeScript on Node.js 24 LTS, Fastify on Cloud Run, Firestore for state, Terraform for infrastructure.

## Orientation

- [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — non-negotiable rules. **Read this in full before editing `app/`**; it is short by design so it can be self-checked in one pass.
- [docs/README.md](docs/README.md) — the docs index, project scope, and the questions still open.
- [docs/architecture.md](docs/architecture.md) — how the pieces fit, including every GCP resource.
- [docs/reference/](docs/reference/) — behaviour, one document per concern: [input contract](docs/reference/input-contract.md), [ingest API](docs/reference/ingest-api.md), [persistence](docs/reference/persistence.md), [Strava](docs/reference/strava.md), [activity text](docs/reference/activity-text.md), [configuration](docs/reference/configuration.md).
- [docs/reference/style-rules.md](docs/reference/style-rules.md) — the code style rules. Read the rules that bear on what you are writing before you write it, not after review.
- [docs/operations.md](docs/operations.md) — deploys, secrets, the Shortcut, re-parsing, and the live check scripts.
- [docs/decisions/](docs/decisions/README.md) — ADRs. Check here before revisiting a choice that looks questionable in isolation.

Read the document that covers what you are changing, not the whole tree.

## Working in this repo

- `npm test` and `npm run typecheck` must pass before a change is done. Verify behaviour by running it, not by reading it.
- Strict TypeScript throughout `app/`, `scripts/`, `tests/`; no Python tooling or implementations. Every module under `app/` has a matching `tests/test_<module>.ts`, and a new module is added to the layout in [docs/reference/configuration.md](docs/reference/configuration.md).
- New and changed TypeScript follows [docs/reference/style-rules.md](docs/reference/style-rules.md). Cite the rule ID when a review comment or a deviation turns on one.
- Keep persisted Firestore field names in the snake_case forms the reference docs define; renaming one is a data migration, not a cleanup.
- Never print, log, or commit a secret. `raw_text` is deliberately logged; credentials never are ([Constraint 7](docs/CONSTRAINTS.md)).
- A Strava read payload must not land in an agent's context — write it to a gitignored file and quote only what you need ([Constraint 2](docs/CONSTRAINTS.md)).
- Infrastructure changes go through `terraform/`. `gcloud` is for reading, never for mutating.
- If a change would violate a rule in [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md), stop and re-read the linked reference section rather than routing around it.
- If a reference document turns out to be wrong, fix the document in the same change rather than leaving the code and the docs disagreeing.
- When asked to create or update a skill, assume the repo-local `.codex/skills/` copy unless a global skill is explicitly requested.

## Work style

Work happens as ordinary branches and pull requests; there is no task queue or status ledger to consult. Repo-local skills cover the recurring jobs: `code-cleanup` for applying the style rules to named files, `cleanup-rules-update` for changing those rules, `strava-bot-e2e-check` for a live end-to-end check, and `review-strava-bot-cloud-run-logs` for log triage.
