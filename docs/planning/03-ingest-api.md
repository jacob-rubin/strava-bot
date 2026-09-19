---
status: authoritative
last-updated: 2026-09-19
---

← [Index](../PLANNING.md)

## 5. Ingest API

### `POST /ingest/{path_token}`

**Request**

|              |                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Content-Type | `text/plain; charset=utf-8` (accept `application/json` with `{"text": "..."}` as an alternative) |
| Body         | Strong share text, verbatim, unmodified                                                          |
| Header       | `X-Ingest-Key: <secret>`                                                                         |

**Authentication.** Hash each supplied and expected value to a fixed-length SHA-256 digest, then compare the digests using Node's `crypto.timingSafeEqual`. Do not call `timingSafeEqual` on the raw values because it throws when their byte lengths differ. Failure of either check returns **404** with an empty body — do not return 401, do not distinguish which check failed, do not log the supplied values.

Rationale: Shortcuts has no crypto primitives, so OIDC and HMAC request signing are impossible on the client. A static bearer secret is the only option. Blast radius is bounded: the key permits posting workouts to one Strava account and nothing else.

**Processing order is mandatory** — cheap rejections precede external writes:

1. Auth check → 404
2. `Content-Length` > 64 KiB → 413
3. Parse → 400 with `{"error": "unparseable"}` on failure
4. Idempotency lookup ([§6](04-persistence.md)) → 200 `"already posted: <activity_url>"`
5. Persist raw + parsed
6. Format title + description locally
7. Strava call
8. Persist result

**Responses.** Body is a single plain-text line, ≤200 chars, suitable for display in an iOS notification.

| Status | Body                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 200    | `posted: Deadlift day — 12 sets, 19,650 lb · strava.com/activities/1234567890` |
| 200    | `already posted: strava.com/activities/1234567890`                             |
| 400    | `not a Strong workout`                                                         |
| 413    | `payload too large`                                                            |
| 404    | _(empty)_                                                                      |
| 502    | `strava rejected: <reason>`                                                    |
| 500    | `internal error`                                                               |

### `GET /health`

Returns 200 `ok`. Unauthenticated. No dependency checks. Not `/healthz`: Google's frontend answers that path itself on `*.run.app` and never forwards it to the container, so the route would be unreachable once deployed.

### Deployment

Terraform declares everything except the Cloud Run service itself, and the `gcloud` CLI is never run on the developer's machine to create or update resources ([ADR 0007](../decisions/0007-terraform-for-gcp-infra.md)). The Cloud Run service is deployed by a Cloud Build pipeline that Terraform declares as a `google_cloudbuild_trigger`:

```hcl
resource "google_cloudbuild_trigger" "deploy" {
  name     = "strava-bot-deploy"
  location = "global"

  # Wire source_to_build to the repo (push trigger) so buildpacks build the app source.

  build {
    # Unit tests gate the deploy: steps run in order and the build aborts on
    # the first failure, so a red suite never reaches the buildpacks or deploy
    # steps. `npm ci` installs devDependencies — that is where vitest lives.
    step {
      name       = "node:24-slim"
      entrypoint = "npm"
      args       = ["ci"]
    }
    step {
      name       = "node:24-slim"
      entrypoint = "npm"
      args       = ["test"]
    }
    step {
      name = "gcr.io/k8s-skaffold/pack"
      args = [
        "build",
        "${var.region}-docker.pkg.dev/${var.project_id}/strava-bot/strava-bot",
        "--builder", "gcr.io/buildpacks/builder",
      ]
    }
    step {
      name = "gcr.io/cloud-builders/docker"
      args = ["push", "${var.region}-docker.pkg.dev/${var.project_id}/strava-bot/strava-bot:latest"]
    }
    step {
      name       = "gcr.io/google.com/cloudsdktool/cloud-sdk:slim"
      entrypoint = "gcloud"
      args = [
        "run", "deploy", "strava-bot",
        "--image", "${var.region}-docker.pkg.dev/${var.project_id}/strava-bot/strava-bot:latest",
        "--region", var.region,
        "--allow-unauthenticated",
        "--max-instances", "3",
        "--concurrency", "4",
        "--memory", "512Mi",
        "--timeout", "120",
        "--set-secrets", "INGEST_KEY=strava-bot-ingest-key:latest,INGEST_PATH_TOKEN=strava-bot-path-token:latest,STRAVA_CLIENT_SECRET=strava-client-secret:latest",
      ]
    }
  }
}

data "google_cloud_run_service" "strava_bot" {
  name     = "strava-bot"
  location = var.region
}

output "service_url" {
  value = data.google_cloud_run_service.strava_bot.status[0].url
}
```

The first two steps are the test gate: `npm ci` and `npm test` on the checked-out source. Cloud Build runs steps in order and aborts on the first failure, so a failing unit-test suite blocks both the image build and the deploy. The third step builds with **Google's native buildpacks** (`gcr.io/buildpacks/builder`) — no Dockerfile. `pack` leaves the image in the worker's Docker daemon, so the fourth step has to push it: a build-level `images` list would not be pushed until every step had finished, which is after the deploy step needs to pull it. The fifth step is the only place `gcloud` appears, and only inside Cloud Build; it deploys Cloud Run with the non-negotiable settings. Because Cloud Build owns the service, Terraform reads the deployed URL back through the `data` source rather than declaring the service.

`--allow-unauthenticated` disables Google's IAM check, not the application's. It is required: the Shortcut cannot mint an OIDC token.

**`--max-instances=3` is a cost control, not a performance setting.** The endpoint is public and unauthenticated at the Cloud Run IAM layer, so application-authenticated abuse or a bug can still consume compute. Configure the billing budget alert in the same Terraform config with `google_billing_budget`.

---

← [Index](../PLANNING.md) · Previous: [Input contract](02-input-contract.md) · Next: [Persistence](04-persistence.md)
