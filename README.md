# strava-bot

Post strength workouts logged in the Strong iOS app to Strava automatically, with a deterministic title and description derived from the workout.

Share a finished workout from Strong into an iOS Shortcut, which POSTs the raw share text to a Cloud Run service. The service parses it, stores it, formats the activity text locally, and creates the Strava activity — answering with one plain-text line for the notification.

Single user, single Strava account. TypeScript on Node.js 24 LTS, deployed to Cloud Run by Cloud Build, with infrastructure in Terraform.

## Quickstart

```bash
npm ci
npm test          # vitest
npm run typecheck
npm run dev       # tsx app/server.ts, binds 0.0.0.0:8080
```

`npm run dev` needs `STRAVA_CLIENT_ID` and Application Default Credentials that can read the project's Secret Manager secrets. `GET /health` answers `ok` without touching any dependency.

A push to `main` runs the Cloud Build pipeline: `npm ci`, `npm test`, a buildpacks image, then `gcloud run deploy`. A red test suite never reaches the deploy.

## Documentation

- [docs/README.md](docs/README.md) — index, scope, and the open questions that remain.
- [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — non-negotiable rules; read before touching `app/`.
- [docs/architecture.md](docs/architecture.md) — system context, GCP resources, request path, data model.
- [docs/operations.md](docs/operations.md) — deploying, secrets, the Shortcut, re-parsing, live checks.
- [docs/reference/](docs/reference/) — the behaviour of each part: input contract, ingest API, persistence, Strava, activity text, configuration.
- [docs/decisions/](docs/decisions/README.md) — ADRs, for why rather than what.

