---
status: authoritative
last-updated: 2026-09-13
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
| `LLM_API_KEY`                  | Secret Manager |                              |
| `LOCAL_TZ`                     | env            | `America/Chicago`            |
| `STRAVA_USE_STRUCTURED_UPLOAD` | env            | default `false`              |
| `MAX_BODY_BYTES`               | env            | default `65536`              |
| `ELAPSED_CAP_S`                | env            | default `14400`              |

The service needs `roles/secretmanager.secretAccessor` and, for refresh-token rotation, `roles/secretmanager.secretVersionAdder`.

---

## 10. Repository layout

```
strava-bot/
  app/
    main.ts                 # Fastify server, routes, processing order (§5)
    parser.ts               # Strong share-text parser
    models.ts               # Workout, Exercise, WorkoutSet, summaries
    store.ts                # Firestore: workouts, history
    llm.ts                  # generate() — MUST NOT import strava.ts
    strava.ts               # tokens, createActivity, uploadStructured
    config.ts               # env + Secret Manager
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
    test_llm.ts
    test_strava.ts
    test_ingest.ts
    test_boundaries.ts      # import-boundary enforcement
  terraform/
    main.tf                 # project, APIs, Firestore, secrets, IAM, Cloud Build trigger, budget (§5, ADR 0007)
    variables.tf
    outputs.tf
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

Configure Vitest to include `tests/test_*.ts`. Configure TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, Node-compatible ESM, `rootDir: "."`, and `outDir: "dist"`. The service entrypoint must bind to `0.0.0.0` on `process.env.PORT ?? 8080`; this makes the npm `start` script compatible with Cloud Run and Google's Node.js buildpack.

---

← [Index](../PLANNING.md) · Previous: [Title and description generation](06-llm-generation.md) · Next: [Error handling](08-error-handling.md)
