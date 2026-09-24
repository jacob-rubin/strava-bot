# Architecture

How the Strava Bot service is put together, with an emphasis on the **GCP resources** that carry it. This is a map: behaviour is specified in [reference/](README.md#map) and the non-negotiables in [CONSTRAINTS.md](CONSTRAINTS.md). Every resource below is declared in [`terraform/`](../terraform/) except the Cloud Run service, which the Cloud Build pipeline deploys ([ADR 0007](decisions/0007-terraform-for-gcp-infra.md)).

- **Project:** `strava-bot-508419` · **Region:** `us-central1` · **Runtime:** Node.js 24 LTS, strict TypeScript ([ADR 0008](decisions/0008-typescript-node-runtime.md))
- **Shape:** one public HTTPS endpoint, one Firestore database, five secrets, one user. No queues, no schedulers, no retry infrastructure.

---

## 1. System context

A single user taps Share in Strong, an iOS Shortcut POSTs the raw share text, and one Cloud Run container turns it into a Strava activity.

```mermaid
flowchart LR
    subgraph phone["iPhone"]
        strong["Strong app<br/>Share Workout"]
        shortcut["Shortcut<br/>Post to Strava"]
        notif["iOS notification<br/>one plain-text line"]
    end

    subgraph gcp["GCP project: strava-bot-508419 / us-central1"]
        run["Cloud Run service<br/>strava-bot"]
        fs[("Firestore<br/>native mode")]
        sm[["Secret Manager"]]
    end

    strava["Strava API<br/>www.strava.com/api/v3"]

    strong -->|"share sheet, plain text"| shortcut
    shortcut -->|"POST /ingest/{path_token}<br/>X-Ingest-Key: secret"| run
    run -->|"status line, 200/400/413/404/502/500"| notif
    run <-->|"workouts + history"| fs
    run <-->|"read secrets, add rotated token version"| sm
    run -->|"POST /oauth/token, POST /uploads, GET /uploads/{id}"| strava
```

The Shortcut has no crypto primitives, so it cannot mint an OIDC token — the endpoint is unauthenticated at the Cloud Run IAM layer and authenticated in the application by a static bearer secret plus a secret URL path segment ([ADR 0001](decisions/0001-static-bearer-secret.md)).

---

## 2. GCP resource map

Everything the project contains, grouped by the job it does.

```mermaid
flowchart TB
    subgraph project["google_project.strava_bot — strava-bot-508419"]
        subgraph apis["google_project_service.enabled — enabled APIs"]
            api["run · secretmanager · firestore<br/>cloudbuild · artifactregistry · storage<br/>cloudbilling · billingbudgets · cloudresourcemanager"]
        end

        subgraph compute["Serving"]
            run["Cloud Run service strava-bot<br/>max-instances 3 · concurrency 4<br/>512Mi · timeout 120s · unauthenticated"]
            sa["google_service_account.run<br/>strava-bot-run@ — runtime identity"]
        end

        subgraph data["State"]
            fs[("google_firestore_database.default<br/>name (default) · FIRESTORE_NATIVE<br/>collections: workouts, history")]
        end

        subgraph secrets["google_secret_manager_secret"]
            s1["strava-bot-ingest-key<br/>random_password, 43 chars"]
            s2["strava-bot-path-token<br/>random_password, 43 chars"]
            s3["strava-client-secret<br/>TF_VAR at apply time"]
            s4["strava-refresh-token<br/>written by scripts/authorize.ts,<br/>rotated by the service"]
            s5["github token<br/>authorizes the build connection"]
        end

        subgraph build["Build and release"]
            trig["google_cloudbuild_trigger.deploy<br/>strava-bot-deploy · regional"]
            conn["google_cloudbuildv2_connection.github<br/>+ repository strava-bot"]
            buildsa["google_service_account.build<br/>strava-bot-build@ — pipeline identity"]
            ar["google_artifact_registry_repository.app<br/>us-central1-docker.pkg.dev/.../strava-bot"]
        end

        subgraph cost["Cost control"]
            budget["google_billing_budget.monthly<br/>10 USD/month · 50/90/100% actual<br/>+ 100% forecast"]
        end
    end

    bucket[("gs://strava-bot-508419-tfstate<br/>Terraform remote state<br/>bootstrap — not Terraform-managed")]

    run --> sa
    sa -->|"secretAccessor on the four app secrets"| secrets
    sa -->|"secretVersionAdder"| s4
    run --> fs
    conn --> trig
    trig --> buildsa
    trig -->|"buildpacks image"| ar
    ar -->|"gcloud run deploy"| run
    run -.->|"spend watched by"| budget
    bucket -.->|"holds Terraform state for the whole project"| trig
```

| Terraform address | GCP resource | Why it exists |
| --- | --- | --- |
| `google_project.strava_bot` | Project `strava-bot-508419` | Blast-radius boundary; imported, not created |
| `google_project_service.enabled` | Enabled APIs | API enablement stays in Terraform, never the Console |
| `google_firestore_database.default` | Firestore, native mode | Dedupe/idempotency and rolling per-exercise history ([persistence](reference/persistence.md)) |
| `google_service_account.run` | `strava-bot-run@` | Cloud Run runtime identity |
| `google_secret_manager_secret.secrets` | The four app secrets | Every Secret-Manager-sourced row of [configuration](reference/configuration.md#configuration) |
| `google_secret_manager_secret_iam_member.accessor` | IAM | Service reads all four at startup |
| `google_secret_manager_secret_iam_member.version_adder` | IAM | Refresh-token rotation write-back ([Constraint 8](CONSTRAINTS.md)) |
| `google_project_iam_member.run_firestore` | `roles/datastore.user` | Every request reads and writes Firestore; without it the service answers only `/health` |
| `google_billing_budget.monthly` | Billing budget | Mandatory pair to `--max-instances=3` ([Constraint 13](CONSTRAINTS.md)) |
| `google_artifact_registry_repository.app` | Artifact Registry repo | Buildpacks have no implicit registry, so the destination must exist first |
| `google_service_account.build` | `strava-bot-build@` | Pipeline identity, kept separate from the identity holding the Strava secrets |
| `google_cloudbuildv2_connection.github` | Build connection + repository | The repo is private, so the trigger cannot clone it anonymously |
| `google_cloudbuild_trigger.deploy` | Cloud Build trigger | Unit tests gate the buildpacks build and the Cloud Run deploy |
| *(none — `data` source only)* | Cloud Run service | Owned by the pipeline; Terraform reads the URL back |
| *(none — bootstrap)* | GCS state bucket | Must exist before the state that would record it |

---

## 3. Request path

The processing order is mandatory: cheap rejections precede external writes ([Constraint 4](CONSTRAINTS.md)).

```mermaid
sequenceDiagram
    autonumber
    participant SC as iOS Shortcut
    participant CR as Cloud Run (app/main.ts)
    participant SM as Secret Manager
    participant FS as Firestore
    participant ST as Strava API

    Note over CR,SM: secrets are read once per process and cached
    CR->>SM: access INGEST_KEY, INGEST_PATH_TOKEN,<br/>STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
    SM-->>CR: latest versions

    SC->>CR: POST /ingest/{path_token} + X-Ingest-Key
    CR->>CR: 1. SHA-256 digests, timingSafeEqual
    Note right of CR: mismatch -> 404, empty body, no request data logged
    CR->>CR: 2. Content-Length > 64 KiB -> 413
    CR->>CR: 3. parse Strong text -> 400 if unparseable
    CR->>FS: 4. lookup dedupe_key, then content_hash
    FS-->>CR: hit -> 200 "already posted: <url>"
    CR->>FS: 5. persist raw_text + parsed, status="received"
    Note right of FS: raw_text is stored even on a 400
    CR->>FS: 6. read history/{exercise_name} for context
    CR->>CR: 7. format title + description locally,<br/>deterministic, no network
    CR->>ST: 8. POST /uploads (data_type=json, sport_type,<br/>name, description, structured set file)
    ST-->>CR: 201 upload id, then GET /uploads/{id} every 1s<br/>until activity_id, error, or a 30s timeout
    CR->>FS: 9. persist strava.{activity_id,url}, status="posted",<br/>update history/{exercise_name}
    CR-->>SC: 200 "posted: ... · strava.com/activities/123"
```

Failure behaviour, condensed from [ingest-api](reference/ingest-api.md#error-handling):

| Condition | Response | GCP-visible effect |
| --- | --- | --- |
| Bad path token or key | 404, empty body | Bare status counter — never log the supplied values |
| Body > 64 KiB | 413 | Rejected before the body is read |
| Unparseable | 400 | Firestore doc still written with `raw_text` |
| Duplicate | 200 + existing URL | No Strava call, no formatting |
| Strava 401 | refresh once, retry once, then 502 | New Secret Manager version if the token rotated |
| Strava 429 / other 4xx | 502 | `status="failed"`, rate-limit headers logged |
| Firestore unavailable | 500 | **No Strava post without a durable idempotency record** |

There is no dead-letter queue and no background retry ([ADR 0006](decisions/0006-no-retry-queue.md)) — tapping Share again is idempotent by construction.

---

## 4. Build and release pipeline

Terraform declares the pipeline; the pipeline owns the Cloud Run service. `gcloud` never runs on a developer machine to mutate anything.

```mermaid
flowchart LR
    dev["git push to main"] --> trig["google_cloudbuild_trigger.deploy"]

    subgraph cb["Cloud Build"]
        step0["npm ci · npm test (vitest)<br/>node:24-slim — build aborts here on failure"]
        step1["gcr.io/k8s-skaffold/pack<br/>pack build with gcr.io/buildpacks/builder<br/>no Dockerfile"]
        step2["docker push"]
        step3["cloud-sdk:slim<br/>gcloud run deploy strava-bot"]
    end

    trig --> step0 --> step1 --> step2 --> ar["Artifact Registry<br/>us-central1-docker.pkg.dev/<br/>strava-bot-508419/strava-bot"]
    ar --> step3 --> rev["Cloud Run revision<br/>--allow-unauthenticated --max-instances 3<br/>--concurrency 4 --memory 512Mi --timeout 120<br/>--set-secrets INGEST_KEY, INGEST_PATH_TOKEN,<br/>STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN"]

    rev -.->|"status[0].url"| ds["data.google_cloud_run_service.strava_bot"]
    ds -.-> out["terraform output service_url"]

    tf["terraform apply<br/>local, remote GCS state"] --> trig
    tf --> other["project · APIs · Firestore · secrets<br/>IAM · service accounts · budget"]
```

Three rules make this split work:

1. **Terraform owns everything except the service.** Because Cloud Build creates and updates the Cloud Run service, Terraform reads its URL back through a `data` source instead of fighting the pipeline over ownership.
2. **The non-negotiable flags live in the deploy step.** `--max-instances=3` is a cost control on a public endpoint, not a performance knob ([Constraint 13](CONSTRAINTS.md)).
3. **Tests gate the deploy.** The first two steps run `npm ci` and `npm test` on the pushed commit, and Cloud Build aborts on the first failed step — a red suite never reaches the image build, let alone Cloud Run.

Full step list and the reasoning behind the explicit `docker push` are in [operations](operations.md#the-deploy-pipeline).

---

## 5. Identity, IAM and secrets

The runtime service account holds Secret Manager roles plus `roles/datastore.user`, and nothing else. Nothing is granted for Strava, because Strava auth is an application-level bearer token rather than a Google identity.

```mermaid
flowchart LR
    sa["serviceAccount:<br/>strava-bot-run@strava-bot-508419"]

    subgraph roles["Bindings"]
        r1["roles/secretmanager.secretAccessor<br/>per secret, on all 4"]
        r2["roles/secretmanager.secretVersionAdder<br/>on strava-refresh-token only"]
        r3["roles/datastore.user<br/>project-level"]
    end

    sa --> r1
    sa --> r2
    sa --> r3

    r1 --> k1["strava-bot-ingest-key<br/>INGEST_KEY"]
    r1 --> k2["strava-bot-path-token<br/>INGEST_PATH_TOKEN"]
    r1 --> k3["strava-client-secret<br/>STRAVA_CLIENT_SECRET"]
    r1 --> k4["strava-refresh-token<br/>STRAVA_REFRESH_TOKEN"]
    r2 --> k4
    r3 --> fs[("Firestore<br/>workouts · history")]

    env["Plain env vars, not secrets:<br/>STRAVA_CLIENT_ID · LOCAL_TZ<br/>MAX_BODY_BYTES · ELAPSED_CAP_S"]
```

**Refresh-token rotation** is the one place the service writes to Secret Manager. Strava access tokens live 6 hours, so the service refreshes on essentially every invocation, and the response's `refresh_token` may differ from the one sent. Dropping a rotated token locks the integration out permanently and forces a manual re-authorization.

```mermaid
sequenceDiagram
    autonumber
    participant CR as Cloud Run
    participant SM as Secret Manager
    participant ST as Strava OAuth

    CR->>CR: reuse cached access token when<br/>more than 300s remain
    CR->>ST: POST /api/v3/oauth/token<br/>grant_type=refresh_token
    ST-->>CR: access_token, expires_at, refresh_token
    alt refresh_token changed
        CR->>SM: AddSecretVersion(strava-refresh-token)
        Note right of SM: Constraint 8 — persist immediately,<br/>needs secretVersionAdder
    else unchanged
        CR->>CR: keep current version
    end
    CR->>CR: cache access token in memory,<br/>keyed by expires_at, per instance
```

After a 401 the client re-reads `strava-refresh-token` from Secret Manager, bypassing its cache, so an instance holding a token another instance has already superseded recovers without being replaced. The in-memory token cache is per-instance and deliberately not shared — with `--max-instances=3` and roughly five requests a week, a shared cache would be infrastructure bought for nothing.

---

## 6. Data model

One Firestore database in native mode, two collections, no indexes beyond the defaults plus a `content_hash` lookup.

```mermaid
erDiagram
    workouts ||--o{ history : "updates one doc per exercise after a successful post"

    workouts {
        string dedupe_key PK "strong:{slug} or sha256:{32 hex}"
        string content_hash "guards an unstable share slug"
        string raw_text "verbatim, always — enables re-parsing"
        map    parsed "parser output, null when parsing failed"
        timestamp started_at
        int    elapsed_s
        timestamp received_at
        string title
        string description
        map    strava "activity_id, upload_id, url, method"
        string status "received | posted | failed"
        string error
        int    attempts
    }

    history {
        string exercise_name PK
        number best_e1rm
        map    best_top_set "weight, unit, reps"
        timestamp last_performed
        array  recent "last 10: date, top_set, volume"
    }
```

```mermaid
stateDiagram-v2
    [*] --> received: raw_text persisted before any Strava call
    received --> posted: success from POST /uploads, history updated
    received --> failed: Strava 4xx or 429, error recorded
    posted --> posted: repeat Share returns 200 already posted
    failed --> received: user taps Share again, attempts incremented
    posted --> [*]
```

The `content_hash` field exists because rule 1 of the dedupe key rests on the unverified assumption that Strong's share slug is stable across repeated shares. Hashing the content as well makes correctness independent of it ([ADR 0003](decisions/0003-content-hash-dedupe-guard.md)).

---

## 7. Code to resource mapping

```mermaid
flowchart LR
    subgraph app["app/ — deployed to Cloud Run"]
        server["server.ts<br/>process entrypoint"]
        main["main.ts<br/>Fastify routes, processing order"]
        ingest["ingest/<br/>named stages of the request"]
        parser["parser.ts"]
        models["models.ts"]
        store["store.ts"]
        text["activity_text.ts"]
        strava["strava.ts"]
        config["config.ts"]
    end

    subgraph scripts["scripts/ — run by hand, never deployed"]
        auth["authorize.ts<br/>one-time OAuth"]
        probe["probe_upload_json.ts<br/>structured-upload probe"]
        reparse["reparse.ts<br/>re-parse stored raw_text"]
    end

    server --> main
    main --> ingest --> parser --> models
    main --> store
    main --> text
    ingest --> strava
    server --> config

    config -.->|"secretAccessor"| sm[["Secret Manager"]]
    store -.->|"workouts, history"| fs[("Firestore")]
    strava -.->|"HTTPS"| api["Strava API"]
    strava -.->|"AddSecretVersion on rotation"| sm
    auth -.->|"writes first refresh token"| sm
    reparse -.->|"reads raw_text"| fs
```

Infrastructure lives in [`terraform/main.tf`](../terraform/main.tf) — project, APIs, Firestore, secrets, IAM, service accounts, budget, the GitHub build connection, and the Cloud Build trigger.

---

← [Docs index](README.md) · [Constraints](CONSTRAINTS.md) · [Decisions](decisions/README.md)
