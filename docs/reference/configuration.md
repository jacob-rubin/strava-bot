# Configuration and repository layout

## Configuration

| Variable | Source | Notes |
| --- | --- | --- |
| `INGEST_KEY` | Secret Manager | `strava-bot-ingest-key` |
| `INGEST_PATH_TOKEN` | Secret Manager | `strava-bot-path-token`; the URL path segment |
| `STRAVA_CLIENT_ID` | env | not secret |
| `STRAVA_CLIENT_SECRET` | Secret Manager | `strava-client-secret` |
| `STRAVA_REFRESH_TOKEN` | Secret Manager | `strava-refresh-token`; **written back** on rotation |
| `LOCAL_TZ` | env | default `America/Chicago` |
| `STRAVA_USE_STRUCTURED_UPLOAD` | env | default `false`; must be `true` or `false` |
| `MAX_BODY_BYTES` | env | default `65536`; positive integer |
| `ELAPSED_CAP_S` | env | default `14400`; positive integer |
| `PORT` | env | default `8080`; supplied by Cloud Run |

`STRAVA_CLIENT_ID` is the only required env var — a missing value fails startup. Secrets are read lazily on first use and cached per process; the refresh token's cache entry can be invalidated so a rotation performed by another instance is picked up without a redeploy.

The runtime service account needs `roles/secretmanager.secretAccessor` on all four secrets, `roles/secretmanager.secretVersionAdder` on `strava-refresh-token` for rotation, and `roles/datastore.user`, because every request reads and writes the Firestore collections of [persistence](persistence.md).

## Repository layout

```
strava-bot/
  app/
    server.ts               # process entrypoint: loads settings, builds and boots the app
    main.ts                 # Fastify server, routes, processing order
    logging.ts              # RequestLog record and the log writer
    parser.ts               # Strong share-text parser
    models.ts               # Workout, Exercise, WorkoutSet, summaries
    store.ts                # Firestore: workouts, history
    activity_text.ts        # deterministic title + description formatter
    strava.ts               # tokens, createActivity, uploadStructured
    config.ts               # env + Secret Manager
    ingest/                 # named steps and helpers for the ingest sequence
      error.ts              # HTTP-facing ingest error types
      request_text.ts       # content-type-aware request body extraction
      response_text.ts      # success response text
      required_store.ts     # required Firestore operations and failure mapping
      parse_stage.ts        # parse or persist the raw-only failure record
      workout_timing.ts     # local/UTC start time and elapsed duration
      post_stage.ts         # Strava post and terminal result persistence
    ports/                  # injected collaborators, one interface per module
      ingest_settings.ts    # IngestSettings + resolveSettings
      activity_client.ts    # ActivityClient + Strava and unavailable factories
      workout_store_like.ts # WorkoutStoreLike + defaultStore
    util/                   # no imports from domain modules
      attempt.ts            # a thrown failure captured as a value
      http_headers.ts       # single-value header and Content-Length reading
      ingest.ts             # raw-text hashing
      secret_comparison.ts  # constant-time secret comparison
  scripts/
    authorize.ts            # one-time OAuth
    probe_upload_json.ts    # structured-upload probe
    reparse.ts              # re-parse stored raw_text after parser changes
  tests/
    fixtures/*.txt          # share-text samples, including the canonical fixture
    test_*.ts               # one suite per module
  terraform/
    main.tf                 # project, APIs, Firestore, secrets, IAM, build pipeline, budget
    variables.tf
    outputs.tf
  tools/
    post-fixture.ps1        # POST a fixture at the deployed endpoint
    probe-auth.ps1          # check the ingest auth behaviour of a deployment
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
```

There is no `Dockerfile` — the Cloud Build pipeline builds with Google's native buildpacks ([operations](../operations.md#the-deploy-pipeline)).

## Toolchain

Runtime dependencies are `fastify`, `@google-cloud/firestore`, `@google-cloud/secret-manager`, and `luxon`. Development dependencies are `typescript`, `tsx`, `vitest`, `@types/node`, and `@types/luxon`. Node.js 24 LTS, strict TypeScript, and Node's built-in `fetch` for HTTP — do not add another HTTP client or an ORM ([ADR 0008](../decisions/0008-typescript-node-runtime.md)). `package-lock.json` is committed and `engines.node` is `24.x`.

| Script | Command |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `test` | `vitest run` |
| `dev` | `tsx app/server.ts` |
| `start` | `node --enable-source-maps dist/app/server.js` |

Vitest includes `tests/test_*.ts`. TypeScript is configured with `strict: true`, `noUncheckedIndexedAccess: true`, Node-compatible ESM, `rootDir: "."`, and `outDir: "dist"`. The entrypoint binds `0.0.0.0` on `process.env.PORT ?? 8080`, which is what makes `npm start` work under Cloud Run and Google's Node.js buildpack.

Adding a module under `app/` means adding its `tests/test_<module>.ts` and updating the layout above in the same change.

---

← [Docs index](../README.md) · [Operations](../operations.md) · [Architecture](../architecture.md)

