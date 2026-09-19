---
status: authoritative
last-updated: 2026-09-19
---

← [Index](../PLANNING.md)

## 9. Configuration

| Variable                       | Source         | Notes                        |
| ------------------------------ | -------------- | ---------------------------- |
| `INGEST_KEY`                   | Secret Manager |                              |
| `INGEST_PATH_TOKEN`            | Secret Manager | URL path segment             |
| `STRAVA_CLIENT_ID`             | env            | not secret                   |
| `STRAVA_CLIENT_SECRET`         | Secret Manager |                              |
| `STRAVA_REFRESH_TOKEN`         | Secret Manager | **written back** on rotation |
| `LOCAL_TZ`                     | env            | `America/Chicago`            |
| `STRAVA_USE_STRUCTURED_UPLOAD` | env            | default `false`              |
| `MAX_BODY_BYTES`               | env            | default `65536`              |
| `ELAPSED_CAP_S`                | env            | default `14400`              |

The service needs `roles/secretmanager.secretAccessor` and, for refresh-token rotation, `roles/secretmanager.secretVersionAdder`. It also needs `roles/datastore.user`, because every request reads and writes the Firestore collections of [§6](04-persistence.md#6-persistence).

---

## 10. Repository layout

```
strava-bot/
  app/
    main.ts                 # Fastify server, routes, processing order (§5)
    logging.ts              # RequestLog record, per-request state, log writers (§11)
    parser.ts               # Strong share-text parser
    models.ts               # Workout, Exercise, WorkoutSet, summaries
    store.ts                # Firestore: workouts, history
    activity_text.ts        # deterministic title + description formatter
    strava.ts               # tokens, createActivity, uploadStructured
    config.ts               # env + Secret Manager
    ports/                  # injected collaborators, one interface per module
      ingest_settings.ts    # IngestSettings + resolveSettings
      activity_client.ts    # ActivityClient + Strava and unavailable factories
      workout_store_like.ts # WorkoutStoreLike + defaultStore
    util/                   # no imports from domain modules
      attempt.ts            # a thrown failure captured as a value
  scripts/
    authorize.ts            # one-time §7.2
    probe_upload_json.ts    # §7.4 [U] probe
    reparse.ts              # re-parse stored raw_text after parser changes
  tests/
    fixtures/*.txt          # share-text samples, incl. §3 fixture
    test_config.ts
    test_models.ts
    test_parser.ts
    test_store.ts
    test_activity_text.ts
    test_strava.ts
    test_ingest.ts
    test_logging.ts
    test_ingest_settings.ts
    test_activity_client.ts
    test_util_attempt.ts
  terraform/
    main.tf                 # project, APIs, Firestore, secrets, IAM, Cloud Build trigger, budget (§5, ADR 0007)
    variables.tf
    outputs.tf
  tools/
    status.ts               # renders docs/STATUS.md from the docs/status/ ledger; no deps, runs on bare node
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
```

No `Dockerfile` — the Cloud Build pipeline builds with Google's native buildpacks ([§5](03-ingest-api.md#deployment)).

Runtime dependencies are `fastify`, `@google-cloud/firestore`, `@google-cloud/secret-manager`, and `luxon`. Development dependencies are `typescript`, `tsx`, `vitest`, `@types/node`, and `@types/luxon`. Use Node.js 24 LTS, strict TypeScript, and Node's built-in `fetch` for HTTP; do not add another HTTP client or an ORM. Commit `package-lock.json`, set `engines.node` to `24.x`, and provide these npm scripts:

| Script      | Command                                      |
| ----------- | -------------------------------------------- |
| `build`     | `tsc -p tsconfig.json`                       |
| `typecheck` | `tsc -p tsconfig.json --noEmit`              |
| `test`      | `vitest run`                                |
| `dev`       | `tsx app/main.ts`                            |
| `start`     | `node --enable-source-maps dist/app/main.js` |
| `status`    | `node tools/status.ts next`                  |
| `status:write` | `node tools/status.ts write`              |
| `status:check` | `node tools/status.ts check`              |

Configure Vitest to include `tests/test_*.ts`. Configure TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, Node-compatible ESM, `rootDir: "."`, and `outDir: "dist"`. The service entrypoint must bind to `0.0.0.0` on `process.env.PORT ?? 8080`; this makes the npm `start` script compatible with Cloud Run and Google's Node.js buildpack.

---

← [Index](../PLANNING.md) · Previous: [Activity title and description formatting](06-activity-text.md) · Next: [Error handling](08-error-handling.md)
