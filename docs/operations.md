# Operations

Running, deploying, and checking the service. Behaviour is documented in [reference/](README.md#map); this file is about the moving parts around it.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Active Strava subscription | Required to create an API application. |
| Strava API application | Created at `https://www.strava.com/settings/api`. Yields `client_id` and `client_secret`; the callback domain is `localhost` for the one-time authorization. |
| GCP project | Cloud Run, Secret Manager, and Firestore in native mode, all declared in Terraform. |
| Terraform CLI | Google provider; config in [`terraform/`](../terraform/), remote state in GCS ([ADR 0007](decisions/0007-terraform-for-gcp-infra.md)). |
| Node.js 24 LTS + npm | Service, scripts, and tests are strict TypeScript; use the version in `package.json`. |
| `gcloud` CLI | For reading logs and for Application Default Credentials. It is never used to mutate infrastructure. |

## Running locally

```bash
npm ci
npm test          # vitest
npm run typecheck
npm run dev       # tsx app/server.ts, binds 0.0.0.0:8080
```

`npm run dev` needs `STRAVA_CLIENT_ID` in the environment and Application Default Credentials able to read the Secret Manager secrets. `GET /health` answers `ok` without touching any dependency, which is the cheapest way to confirm a local process is up.

## Infrastructure

```bash
cd terraform
terraform apply
```

Everything except the Cloud Run service is declared here — project, APIs, Firestore, secrets and their IAM, the runtime and build service accounts, the Artifact Registry repository, the GitHub build connection, the deploy trigger, and the billing budget. Values that must never be committed are passed through the environment at apply time: `TF_VAR_strava_client_secret`, `TF_VAR_github_token`, and `TF_VAR_github_app_installation_id`.

Useful outputs: `terraform output service_url`, and `terraform output -raw ingest_url` for the `path_token` form of the endpoint used by the Shortcut. The latter is marked sensitive — read it into a variable, never into a commit or an agent transcript.

On a project where the pipeline has never run, the Cloud Run data source would 404 and abort the very apply that creates the pipeline; pass `-var=cloud_run_deployed=false` for that first apply only.

## The deploy pipeline

A push to `main` fires `google_cloudbuild_trigger.deploy`, which runs five steps and aborts on the first failure:

1. `npm ci` on `node:24-slim`
2. `npm test` — a red suite never reaches the image build
3. `pack build` with `gcr.io/buildpacks/builder` — no Dockerfile
4. `docker push` to Artifact Registry — `pack` leaves the image only in the worker's Docker daemon, and a build-level `images` list would not push until after every step, which is too late for the deploy step to pull it
5. `gcloud run deploy strava-bot` with `--allow-unauthenticated --max-instances 3 --concurrency 4 --memory 512Mi --timeout 120` and `--set-secrets` for the four Secret Manager values

`--allow-unauthenticated` disables Google's IAM check, not the application's: the Shortcut cannot mint an OIDC token, so the endpoint authenticates itself ([ingest API](reference/ingest-api.md#authentication)). `--max-instances=3` is a cost control paired with the billing budget, not a performance setting ([Constraint 13](CONSTRAINTS.md)).

The trigger is regional rather than global, because a 2nd-generation repository is regional and a trigger must sit in its repository's region.

## Authorizing Strava

Run once, by hand, and again only if the refresh token is lost:

```bash
npx tsx scripts/authorize.ts
```

It builds the `scope=activity:write` authorization URL, exchanges the code from the `localhost` redirect, and writes the resulting `refresh_token` as a new version of `strava-refresh-token`. Strava may return `read` alongside the requested scope; that grant is accepted ([strava](reference/strava.md#one-time-authorization)).

After that the service rotates the token itself. A rotated value is persisted immediately as a new secret version — losing one locks the integration out and forces this procedure again ([Constraint 8](CONSTRAINTS.md)).

## The iOS Shortcut

Shortcuts app → new shortcut → ⓘ → Details → **Show in Share Sheet**, with accepted input set to **Any**.

```
1. Get Contents of URL
     URL     https://<service>.run.app/ingest/<path_token>
     Method  POST
     Headers X-Ingest-Key: <secret>
             Content-Type: text/plain
     Body    Shortcut Input          ← raw, no transformation
2. Show Notification  ← Contents of URL
```

The Shortcut does no parsing, formatting, or branching; all logic is server-side so a fix is a redeploy. Strong's share sheet delivers the full workout text block, not just the `link.strong.app` URL, so sharing straight into this shortcut is all that is required.

The key lives as plaintext in the Shortcut and syncs via iCloud — never share the shortcut. Rotation is a new secret version plus editing one field.

## Verifying the upload before a deploy

```powershell
npx tsx scripts/probe_upload_json.ts --dry-run
npx tsx scripts/probe_upload_json.ts
```

[`scripts/probe_upload_json.ts`](../scripts/probe_upload_json.ts) sends the canonical fixture through the service's own parse, timing, formatting, and `StravaClient.uploadActivity`, straight to Strava from your machine — so it checks the exact payload a deploy would send, before that deploy. The fixture's date line is rewritten to 45 minutes ago on every run, so a repeat is never rejected as a duplicate.

`--dry-run` reads no secret and sends nothing: it prints each fixture exercise's mapped `exercise_type`, then the multipart fields (`data_type`, `sport_type`, `name`, `description`, whether `activity_type` is present) and the full upload file. The live run needs the local `.env` and Secret Manager access, **creates a real Strava activity**, and persists a rotated refresh token like the service does ([Constraint 8](CONSTRAINTS.md)).

A live run prints `accepted`, the activity link, and a checklist to confirm on strava.com: Weight Training as the sport type, the four fixture exercises, 12 sets, and weights in kilograms. An upload-created activity returns 404 on API `GET` and `DELETE`, so this visual check is the only readback — then delete the activity by hand. A failure prints only `rejected: stage=… status=…`, read as described below. Full Strava responses go to a JSONL file in the temp directory, with the token response redacted ([Constraint 2](CONSTRAINTS.md)).

The probe runs locally before a deploy; [Checking a deployment](#checking-a-deployment) and the `strava-bot-e2e-check` skill post to the deployed `/ingest` after one.

## Checking a deployment

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/probe-auth.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/post-fixture.ps1 -Fresh
```

[`tools/probe-auth.ps1`](../tools/probe-auth.ps1) is the read-only check: a wrong `path_token` and a wrong `X-Ingest-Key` must each return 404 with an empty body. It prints status codes and body sizes only.

[`tools/post-fixture.ps1`](../tools/post-fixture.ps1) posts a fixture exactly as the Shortcut would and **creates a real Strava activity** when it succeeds. `-DryRun` prints the payload and sends nothing; `-Fixture <name>` picks any file under `tests/fixtures`; `-Fresh` rewrites both the slug and the date line so the payload is genuinely new to the idempotency layer — without it, a repeat run correctly answers `already posted`.

Neither script prints a secret, so their output is safe to paste into an issue or an agent context.

Reading a 502: `401` from `structured_upload` means the refresh succeeded and the upload was still refused, which is a scope problem on the stored refresh token rather than an expired token; `400` is a payload problem; `429` is a rate limit. A `token_refresh` stage means the refresh itself was rejected. `POST /uploads` is the only Strava write, so there is no fallback to read past ([ADR 0015](decisions/0015-uploads-only-strava-path.md)); an activity it creates is invisible to the app's own scope and must be deleted by hand on strava.com.

## Re-parsing stored workouts

`raw_text` is persisted for every request, including ones that failed to parse, which is what makes a parser fix retroactive:

```bash
npx tsx scripts/reparse.ts            # dry run — reports differences, writes nothing
npx tsx scripts/reparse.ts --write    # persist the re-parsed map where it changed
```

The dry run is the default so an accidental invocation cannot write. A document whose `raw_text` no longer parses at all is reported and never written: overwriting a good `parsed` map with null would discard exactly the history [Constraint 6](CONSTRAINTS.md) exists to keep.

---

← [Docs index](README.md) · [Architecture](architecture.md) · [Configuration](reference/configuration.md)

