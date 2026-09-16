# Architecture

How the Strava Bot service is put together, with an emphasis on the **GCP resources** that carry it. This is a map, not a spec: the authoritative behaviour lives in [docs/PLANNING.md](docs/PLANNING.md) and the non-negotiables in [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md). Every resource below is declared in [`terraform/`](terraform/) except the Cloud Run service, which the Cloud Build pipeline deploys ([ADR 0007](docs/decisions/0007-terraform-for-gcp-infra.md)).

- **Project:** `strava-bot-508419` · **Region:** `us-central1` · **Runtime:** Node.js 24 LTS, strict TypeScript ([ADR 0008](docs/decisions/0008-typescript-node-runtime.md))
- **Shape:** one public HTTPS endpoint, one Firestore database, four secrets, one user. No queues, no schedulers, no retry infrastructure.

Diagram legend: solid = applied today; **dashed = declared but not yet deployed** (the Cloud Build trigger and the Cloud Run service land in [T19](docs/tasks/T19-cloud-run-deploy.md); see [docs/STATUS.md](docs/STATUS.md)).

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
        sm[["Secret Manager<br/>4 secrets"]]
    end

    strava["Strava API<br/>www.strava.com/api/v3"]

    strong -->|"share sheet, plain text"| shortcut
    shortcut -->|"POST /ingest/{path_token}<br/>X-Ingest-Key: secret"| run
    run -->|"status line, 200/400/413/404/502/500"| notif
    run <-->|"workouts + history"| fs
    run <-->|"read secrets, add rotated token version"| sm
    run -->|"POST /oauth/token, POST /activities"| strava

    classDef planned stroke-dasharray:5 5,stroke-width:2px;
    class run planned;
```

The Shortcut has no crypto primitives, so it cannot mint an OIDC token — the endpoint is unauthenticated at the Cloud Run IAM layer and authenticated in the application by a static bearer secret plus a secret URL path segment ([ADR 0001](docs/decisions/0001-static-bearer-secret.md)).

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

        subgraph secrets["google_secret_manager_secret.secrets"]
            s1["strava-bot-ingest-key<br/>random_password, 43 chars"]
            s2["strava-bot-path-token<br/>random_password, 43 chars"]
            s3["strava-client-secret<br/>TF_VAR at apply time"]
            s4["strava-refresh-token<br/>written by scripts/authorize.ts,<br/>rotated by the service"]
        end

        subgraph build["Build and release"]
            trig["google_cloudbuild_trigger.deploy<br/>strava-bot-deploy"]
            ar["Artifact Registry repo<br/>us-central1-docker.pkg.dev/.../strava-bot"]
        end

        subgraph cost["Cost control"]
            budget["google_billing_budget.monthly<br/>10 USD/month · 50/90/100% actual<br/>+ 100% forecast"]
        end
    end

    bucket[("gs://strava-bot-508419-tfstate<br/>Terraform remote state<br/>bootstrap — not Terraform-managed")]

    run --> sa
    sa -->|"secretAccessor on all four"| secrets
    sa -->|"secretVersionAdder"| s4
    run --> fs
    trig -->|"buildpacks image"| ar
    ar -->|"gcloud run deploy"| run
    run -.->|"spend watched by"| budget
    bucket -.->|"holds Terraform state for the whole project"| trig

    classDef planned stroke-dasharray:5 5,stroke-width:2px;
    class run,trig,ar planned;
```

| Terraform address | GCP resource | Why it exists |
| --- | --- | --- |
| `google_project.strava_bot` | Project `strava-bot-508419` | Blast-radius boundary; imported, not created |
| `google_project_service.enabled` | 9 enabled APIs | API enablement stays in Terraform, never the Console |
| `google_firestore_database.default` | Firestore, native mode | Dedupe/idempotency + rolling per-exercise history ([§6](docs/planning/04-persistence.md)) |
| `google_service_account.run` | `strava-bot-run@` | Cloud Run runtime identity, Secret Manager roles only |
| `google_secret_manager_secret.secrets` | 4 secrets | Every Secret-Manager-sourced row of [§9](docs/planning/07-config-and-repo-layout.md#9-configuration) |
| `google_secret_manager_secret_iam_member.accessor` | IAM | Service reads all four at startup |
| `google_secret_manager_secret_iam_member.version_adder` | IAM | Refresh-token rotation write-back ([Constraint 8](docs/CONSTRAINTS.md)) |
| `google_billing_budget.monthly` | Billing budget | Mandatory pair to `--max-instances=3` ([Constraint 13](docs/CONSTRAINTS.md)) |
| `google_cloudbuild_trigger.deploy` | Cloud Build trigger | Builds with buildpacks, deploys Cloud Run ([T19](docs/tasks/T19-cloud-run-deploy.md)) |
| *(none — `data` source only)* | Cloud Run service | Owned by the pipeline; Terraform reads the URL back |
| *(none — bootstrap)* | GCS state bucket | Must exist before the state that would record it |

---

## 3. Request path

The processing order is mandatory: cheap rejections precede external writes ([Constraint 4](docs/CONSTRAINTS.md)).

```mermaid
sequenceDiagram
    autonumber
    participant SC as iOS Shortcut
    participant CR as Cloud Run (app/main.ts)
    participant SM as Secret Manager
    participant FS as Firestore
    participant ST as Strava API

    Note over CR,SM: cold start only — secrets read once into config
    CR->>SM: access INGEST_KEY, INGEST_PATH_TOKEN,<br/>STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
    SM-->>CR: latest versions

    SC->>CR: POST /ingest/{path_token} + X-Ingest-Key
    CR->>CR: 1. SHA-256 digests, timingSafeEqual
    Note right of CR: mismatch -> 404, empty body, no log
    CR->>CR: 2. Content-Length > 64 KiB -> 413
    CR->>CR: 3. parse Strong text -> 400 if unparseable
    CR->>FS: 4. lookup dedupe_key, then content_hash
    FS-->>CR: hit -> 200 "already posted: <url>"
    CR->>FS: 5. persist raw_text + parsed, status="received"
    Note right of FS: raw_text is stored even on a 400
    CR->>CR: 6. format title + description locally,<br/>deterministic, no network
    CR->>ST: 7. POST /activities (name, sport_type, start_date_local,<br/>elapsed_time, description)
    ST-->>CR: 201 (body may be zero-byte — [U])
    CR->>FS: 8. persist strava.{activity_id,url}, status="posted",<br/>update history/{exercise_name}
    CR-->>SC: 200 "posted: ... · strava.com/activities/123"
```

Failure behaviour, condensed from [§11](docs/planning/08-error-handling.md):

| Condition | Response | GCP-visible effect |
| --- | --- | --- |
| Bad path token or key | 404, empty body | Counter only — never log the supplied values |
| Body > 64 KiB | 413 | Rejected before the body is read |
| Unparseable | 400 | Firestore doc still written with `raw_text` |
| Duplicate | 200 + existing URL | No Strava call, no formatting |
| Strava 401 | refresh once, retry once, then 502 | New Secret Manager version if the token rotated |
| Strava 429 / other 4xx | 502 | `status="failed"`, rate-limit headers logged |
| Firestore unavailable | 500 | **No Strava post without a durable idempotency record** |

There is no dead-letter queue and no background retry ([ADR 0006](docs/decisions/0006-no-retry-queue.md)) — tapping Share again is idempotent by construction.

---

## 4. Build and release pipeline

Terraform declares the pipeline; the pipeline owns the Cloud Run service. `gcloud` never runs on a developer machine to mutate anything.

```mermaid
flowchart LR
    dev["git push<br/>to the wired branch"] --> trig["google_cloudbuild_trigger.deploy"]

    subgraph cb["Cloud Build"]
        step1["step 1 — gcr.io/k8s-skaffold/pack<br/>pack build with gcr.io/buildpacks/builder<br/>no Dockerfile"]
        step2["step 2 — cloud-sdk:slim<br/>gcloud run deploy strava-bot"]
    end

    trig --> step1 --> ar["Artifact Registry<br/>us-central1-docker.pkg.dev/<br/>strava-bot-508419/strava-bot"]
    ar --> step2 --> rev["Cloud Run revision<br/>--allow-unauthenticated --max-instances 3<br/>--concurrency 4 --memory 512Mi --timeout 120<br/>--set-secrets INGEST_KEY, INGEST_PATH_TOKEN,<br/>STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN"]

    rev -.->|"status[0].url"| ds["data.google_cloud_run_service.strava_bot"]
    ds -.-> out["terraform output service_url"]

    tf["terraform apply<br/>local, remote GCS state"] --> trig
    tf --> other["project · APIs · Firestore · secrets<br/>IAM · runtime SA · budget"]

    classDef planned stroke-dasharray:5 5,stroke-width:2px;
    class trig,step1,step2,ar,rev,ds,out planned;
```

Two rules make this split work:

1. **Terraform owns everything except the service.** Because Cloud Build creates and updates the Cloud Run service, Terraform reads its URL back through a `data` source instead of fighting the pipeline over ownership.
2. **The non-negotiable flags live in the deploy step.** `--max-instances=3` is a cost control on a public endpoint, not a performance knob ([Constraint 13](docs/CONSTRAINTS.md)).

---

## 5. Identity, IAM and secrets

The runtime service account holds Secret Manager roles and nothing else. Nothing is granted for Strava, because Strava auth is an application-level bearer token rather than a Google identity. Note that no Firestore role is declared for `strava-bot-run@` in `terraform/` today — `roles/datastore.user` has to be added before the deployed service can read or write `workouts` and `history` ([T13](docs/tasks/T13-store-workouts.md), [T19](docs/tasks/T19-cloud-run-deploy.md)).

```mermaid
flowchart LR
    sa["serviceAccount:<br/>strava-bot-run@strava-bot-508419"]

    subgraph roles["Bindings — per secret, not project-wide"]
        r1["roles/secretmanager.secretAccessor<br/>on all 4 secrets"]
        r2["roles/secretmanager.secretVersionAdder<br/>on strava-refresh-token only"]
    end

    sa --> r1
    sa --> r2

    r1 --> k1["strava-bot-ingest-key<br/>INGEST_KEY"]
    r1 --> k2["strava-bot-path-token<br/>INGEST_PATH_TOKEN"]
    r1 --> k3["strava-client-secret<br/>STRAVA_CLIENT_SECRET"]
    r1 --> k4["strava-refresh-token<br/>STRAVA_REFRESH_TOKEN"]
    r2 --> k4

    env["Plain env vars, not secrets:<br/>STRAVA_CLIENT_ID · LOCAL_TZ<br/>STRAVA_USE_STRUCTURED_UPLOAD<br/>MAX_BODY_BYTES · ELAPSED_CAP_S"]
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

The in-memory token cache is per-instance and deliberately not shared — with `--max-instances=3` and roughly five requests a week, a shared cache would be infrastructure bought for nothing.

---

## 6. Data model

One Firestore database in native mode, two collections, no indexes beyond the defaults plus a `content_hash` lookup.

```mermaid
erDiagram
    workouts ||--o{ history : "updates one doc per exercise after a successful post"

    workouts {
        string dedupe_key PK "strong:{slug} or sha256:{32 hex}"
        string content_hash "guards the [U] slug-stability claim"
        string raw_text "verbatim, always — enables re-parsing"
        map    parsed "parser output"
        timestamp started_at
        int    elapsed_s
        timestamp received_at
        string title "null until formatted"
        string description "null until formatted"
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
    received --> posted: 201 from POST /activities, history updated
    received --> failed: Strava 4xx or 429, error recorded
    posted --> posted: repeat Share returns 200 already posted
    failed --> received: user taps Share again, attempts incremented
    posted --> [*]
```

The `content_hash` column exists because rule 1 of the dedupe key rests on an unverified claim — that Strong's share slug is stable across repeated shares. Hashing the content as well makes correctness independent of that claim ([ADR 0003](docs/decisions/0003-content-hash-dedupe-guard.md)).

---

## 7. Cost and abuse posture

The endpoint is public at the IAM layer by necessity, so the controls are layered rather than perimeter-based:

| Layer | Control | Resource |
| --- | --- | --- |
| Network | HTTPS only, Google-managed cert | Cloud Run default |
| URL | secret 43-char path segment | `strava-bot-path-token` |
| Header | `X-Ingest-Key`, constant-time digest compare | `strava-bot-ingest-key` |
| Size | 64 KiB cap before the body is read | `MAX_BODY_BYTES` |
| Compute | `--max-instances=3`, `--concurrency=4`, scale to zero | deploy step |
| Spend | 10 USD/month budget, alerts at 50/90/100% actual + 100% forecast | `google_billing_budget.monthly` |
| Blast radius | one Strava account, `activity:write` scope | Strava app config |

Expected volume is about five requests a week, so Strava's rate limits (200 per 15 min, 2,000 per day) are never in play — the usage headers are logged only because a runaway loop shows up there first.

---

## 8. Deliberately absent

Architecture is as much about what is not here. None of the following exists, and nothing should be built toward it:

- **No AI component anywhere in the MVP** — no SDK, no model call, no prompt, no credential. Strava API Policy §5.3 forbids Strava data in connection with any AI application, and the absence of an AI component is the entire compliance story ([Constraint 1](docs/CONSTRAINTS.md)).
- **No Pub/Sub, Cloud Tasks, Cloud Scheduler, or retry queue** — retries are the user tapping Share again ([ADR 0006](docs/decisions/0006-no-retry-queue.md)).
- **No Cloud Load Balancer, Cloud Armor, VPC, or Serverless VPC connector** — a single public Cloud Run URL is the whole surface.
- **No Dockerfile** — Google's native buildpacks build the image ([§10](docs/planning/07-config-and-repo-layout.md#10-repository-layout)).
- **No user table, no multi-tenancy, no media storage** — Strava's API has no media endpoint, and there is exactly one user ([§1](docs/planning/01-purpose-and-prerequisites.md)).
- **No `gcloud` mutations from a laptop and no Console clicks** — the sole exception is the bootstrap state bucket ([ADR 0007](docs/decisions/0007-terraform-for-gcp-infra.md)).

---

## 9. Code to resource mapping

```mermaid
flowchart LR
    subgraph app["app/ — deployed to Cloud Run"]
        main["main.ts<br/>Fastify routes, processing order"]
        parser["parser.ts"]
        models["models.ts"]
        store["store.ts"]
        text["activity_text.ts"]
        strava["strava.ts"]
        config["config.ts"]
    end

    subgraph scripts["scripts/ — run by hand, never deployed"]
        auth["authorize.ts<br/>one-time OAuth"]
        probe["probe_upload_json.ts<br/>[U] structured upload"]
        reparse["reparse.ts<br/>re-parse stored raw_text"]
    end

    main --> parser --> models
    main --> store
    main --> text
    main --> strava
    main --> config

    config -.->|"secretAccessor"| sm[["Secret Manager"]]
    store -.->|"workouts, history"| fs[("Firestore")]
    strava -.->|"HTTPS"| api["Strava API"]
    strava -.->|"AddSecretVersion on rotation"| sm
    auth -.->|"writes first refresh token"| sm
    reparse -.->|"reads raw_text"| fs
```

Infrastructure lives in [`terraform/main.tf`](terraform/main.tf) — project, APIs, Firestore, secrets, IAM, runtime service account, budget, and (at [T19](docs/tasks/T19-cloud-run-deploy.md)) the Cloud Build trigger.

---

← [README](README.md) · [Spec index](docs/PLANNING.md) · [Constraints](docs/CONSTRAINTS.md) · [Decisions](docs/decisions/README.md)
