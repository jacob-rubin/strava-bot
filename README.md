# strava-bot

Post strength workouts logged in the Strong iOS app to Strava automatically, with a deterministic title and description derived from the workout.

This repo is spec-first and implementation is in progress. The service uses TypeScript on Node.js 24 LTS; the implementation spec lives under [`docs/`](docs/), split into small files for progressive disclosure.

- [docs/tasks/README.md](docs/tasks/README.md) — **start here to build**: one runbook per atomic task, with a done-check each.
- [docs/STATUS.md](docs/STATUS.md) — per-task status and open items; the single source of truth for progress.
- [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — non-negotiable rules; read before touching `app/`.
- [docs/PLANNING.md](docs/PLANNING.md) — index into the full spec and the build order.
- [docs/glossary.md](docs/glossary.md) — domain terms.
