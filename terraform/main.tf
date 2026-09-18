# strava-bot GCP infrastructure (T02).
#
# Terraform declares everything except the Cloud Run service itself, which the
# Cloud Build pipeline deploys; the gcloud CLI is never run locally to create or
# update resources (docs/decisions/0007-terraform-for-gcp-infra.md).
# The google_cloudbuild_trigger and google_billing_budget are added by T19.
#
# State can contain secret material once T03 adds secret versions, so it lives
# in the remote GCS backend below (versioned, uniform ACLs, public access
# prevented) rather than on disk or in VCS — the "prefer a remote backend" half
# of ADR 0007. The bucket is the one bootstrap resource Terraform cannot own:
# it must exist before its own state does, so it was created once with the
# gcloud CLI and is not declared here.

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }

    # T03 generates INGEST_KEY and INGEST_PATH_TOKEN rather than taking them
    # from a file that could be committed.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend config takes no variables, so the bucket is literal; the project id
  # it is named after is not a secret.
  backend "gcs" {
    bucket = "strava-bot-508419-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# The Budgets API bills quota to the caller's own project, which for local ADC
# is whatever gcloud set, not this one. This alias attributes that quota to
# strava-bot's project, where billingbudgets is enabled below. It is scoped to
# the budget alone: applying it provider-wide would make even reading the
# project depend on APIs that are not enabled yet on a fresh project.
provider "google" {
  alias   = "billing"
  project = var.project_id
  region  = var.region

  billing_project       = var.project_id
  user_project_override = true
}

locals {
  # The Secret-Manager-sourced rows of §9 Configuration, keyed by the env var
  # the service reads. Values are the secret names the Cloud Build deploy step
  # in §5 Deployment already references. Versions are created below (T03),
  # except STRAVA_REFRESH_TOKEN, which is populated by scripts/authorize.py
  # (T06) and rewritten by the service on rotation (Constraint 8).
  secrets = {
    INGEST_KEY           = "strava-bot-ingest-key"
    INGEST_PATH_TOKEN    = "strava-bot-path-token"
    STRAVA_CLIENT_SECRET = "strava-client-secret"
    STRAVA_REFRESH_TOKEN = "strava-refresh-token"
  }

  # Secrets the running service writes new versions of.
  rotated_secrets = ["STRAVA_REFRESH_TOKEN"]

  services = [
    "artifactregistry.googleapis.com",
    # Cloud Billing + Budgets back the budget alert below (Constraint 13).
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    # Not in T02's list, but the remote state bucket lives in this project.
    "storage.googleapis.com",
  ]

  firestore_location = coalesce(var.firestore_location, var.region)
}

resource "google_project" "strava_bot" {
  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account
  org_id          = var.org_id
  folder_id       = var.folder_id
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = google_project.strava_bot.project_id
  service = each.value

  disable_dependent_services = false
  disable_on_destroy         = false
}

# §6 Persistence assumes Firestore in native mode, not Datastore mode.
resource "google_firestore_database" "default" {
  project     = google_project.strava_bot.project_id
  name        = "(default)"
  location_id = local.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.enabled]
}

# Cloud Run runtime identity. The Cloud Build deploy step (T19) runs the service
# as this account; it holds only the Secret Manager roles §9 requires.
resource "google_service_account" "run" {
  project      = google_project.strava_bot.project_id
  account_id   = "strava-bot-run"
  display_name = "strava-bot Cloud Run runtime"

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret" "secrets" {
  for_each = local.secrets

  project   = google_project.strava_bot.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

# T03 step 2: the two ingest secrets are generated here, never typed or read
# from a file. 43 alphanumeric characters is ~256 bits of entropy, comfortably
# past the 32-byte floor, and every character is URL-safe — INGEST_PATH_TOKEN
# is a path segment of POST /ingest/{path_token} (§5), and ADR 0001 makes both
# of these static bearer secrets the whole of the endpoint's authentication.
resource "random_password" "ingest_key" {
  length  = 43
  special = false
}

resource "random_password" "ingest_path_token" {
  length  = 43
  special = false
}

# One enabled version per Secret-Manager-sourced variable of §9, except
# STRAVA_REFRESH_TOKEN, whose first version is written by T06's
# scripts/authorize.ts and rewritten by the service on rotation.
resource "google_secret_manager_secret_version" "ingest_key" {
  secret      = google_secret_manager_secret.secrets["INGEST_KEY"].id
  secret_data = random_password.ingest_key.result
  enabled     = true
}

resource "google_secret_manager_secret_version" "ingest_path_token" {
  secret      = google_secret_manager_secret.secrets["INGEST_PATH_TOKEN"].id
  secret_data = random_password.ingest_path_token.result
  enabled     = true
}

# T03 step 3: the value comes from TF_VAR_strava_client_secret in the applying
# shell's environment, never from a file that could be committed.
resource "google_secret_manager_secret_version" "strava_client_secret" {
  secret      = google_secret_manager_secret.secrets["STRAVA_CLIENT_SECRET"].id
  secret_data = var.strava_client_secret
  enabled     = true
}

# §9: the service reads every secret above at startup.
resource "google_secret_manager_secret_iam_member" "accessor" {
  # Keyed off the static local, not the resource map, so the key set is known
  # at plan time (a resource-derived for_each blocks plan/import).
  for_each = local.secrets

  project   = google_secret_manager_secret.secrets[each.key].project
  secret_id = google_secret_manager_secret.secrets[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

# §9 / Constraint 8: a rotated refresh token must be persisted immediately as a
# new version, so the runtime account can add versions to that secret alone.
resource "google_secret_manager_secret_iam_member" "version_adder" {
  for_each = toset(local.rotated_secrets)

  project   = google_secret_manager_secret.secrets[each.value].project
  secret_id = google_secret_manager_secret.secrets[each.value].secret_id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.run.email}"
}

# §9 lists only the two Secret Manager roles, but §6 Persistence has the same
# service reading and writing `workouts` and `history` on every request, and
# Constraint 11 makes a Firestore failure a 500 rather than a skipped write. A
# deployment without this is a service that answers /healthz and nothing else.
resource "google_project_iam_member" "run_firestore" {
  project = google_project.strava_bot.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run.email}"
}


# Constraint 13: the endpoint is public and invokes a paid model, so the
# --max-instances=3 cost control must be paired with a billing budget alert.
# Formally T19's resource; landed early so no spend can happen unwatched.
# Alerts email the billing account's admins and users by default — no
# notification channel is wired up.
resource "google_billing_budget" "monthly" {
  provider = google.billing

  billing_account = var.billing_account
  display_name    = "strava-bot monthly budget"

  budget_filter {
    projects        = ["projects/${google_project.strava_bot.number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  # Actual spend past the cap is the alert that was asked for; the earlier
  # actual threshold and the forecast rule are the warning shots before it.
  dynamic "threshold_rules" {
    for_each = var.budget_actual_thresholds

    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.enabled]
}

# ---------------------------------------------------------------------------
# T19 — the build-and-deploy pipeline (§5 Deployment, ADR 0007)
#
# Terraform stops at the trigger: the Cloud Run service itself is created by
# the pipeline below, and is read back through a data source further down.
# ---------------------------------------------------------------------------

locals {
  # The single image the buildpacks step publishes and the deploy step pulls.
  # Untagged here because `pack` and `gcloud run deploy` want different forms.
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/strava-bot"

  # §5 Deployment shows --set-secrets with three of the four Secret-Manager
  # variables of §9; deriving it from local.secrets binds every one of them and
  # keeps a future secret from being silently left off the service.
  run_secrets = join(",", [for env_var, secret in local.secrets : "${env_var}=${secret}:latest"])

  # The non-secret env rows of §9. The rest of §9's env variables are optional
  # and the service already defaults them to the documented values.
  run_env_vars = join(",", [
    "STRAVA_CLIENT_ID=${var.strava_client_id}",
    "LOCAL_TZ=${var.local_tz}",
  ])
}

# Buildpacks have no Dockerfile and no implicit registry, so the destination
# repository has to exist before the first build.
resource "google_artifact_registry_repository" "app" {
  project       = google_project.strava_bot.project_id
  location      = var.region
  repository_id = "strava-bot"
  format        = "DOCKER"
  description   = "Buildpacks images for the strava-bot Cloud Run service."

  depends_on = [google_project_service.enabled]
}

# The pipeline's own identity, kept separate from the runtime identity so the
# thing that can deploy Cloud Run is not the thing that holds the Strava
# secrets. Builds run as this account rather than the legacy Cloud Build
# service account, which new projects no longer get.
resource "google_service_account" "build" {
  project      = google_project.strava_bot.project_id
  account_id   = "strava-bot-build"
  display_name = "strava-bot Cloud Build pipeline"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "build" {
  for_each = toset([
    # Push the buildpacks image to the repository above.
    "roles/artifactregistry.writer",
    # A user-specified build service account writes its own logs.
    "roles/logging.logWriter",
    # Deploy the service, and set --allow-unauthenticated on it.
    "roles/run.admin",
  ])

  project = google_project.strava_bot.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}

# --service-account on the deploy step assigns the runtime identity, which
# Cloud Run only permits to a principal allowed to act as it.
resource "google_service_account_iam_member" "build_uses_runtime_identity" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

# --- Source: the GitHub repository the trigger builds from --------------------
#
# The repository is private, so Cloud Build cannot clone it anonymously and the
# connection is not optional. ADR 0007 rules out creating it in the Console, so
# it is declared here and fed the two values only GitHub can issue: the Cloud
# Build GitHub App's installation id and a personal access token, both supplied
# at apply time from TF_VAR_* like every other secret in this config.

resource "google_secret_manager_secret" "github_token" {
  project   = google_project.strava_bot.project_id
  secret_id = "strava-bot-github-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "github_token" {
  secret      = google_secret_manager_secret.github_token.id
  secret_data = var.github_token
  enabled     = true
}

# The connection is read by Cloud Build's own service agent, not by the build
# service account, so the accessor binding goes to the agent.
resource "google_secret_manager_secret_iam_member" "github_token_accessor" {
  project   = google_secret_manager_secret.github_token.project
  secret_id = google_secret_manager_secret.github_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${google_project.strava_bot.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

resource "google_cloudbuildv2_connection" "github" {
  project  = google_project.strava_bot.project_id
  location = var.region
  name     = "github"

  github_config {
    app_installation_id = var.github_app_installation_id

    authorizer_credential {
      oauth_token_secret_version = google_secret_manager_secret_version.github_token.id
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.github_token_accessor]
}

resource "google_cloudbuildv2_repository" "app" {
  project           = google_project.strava_bot.project_id
  location          = var.region
  name              = "strava-bot"
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = var.github_repo_uri
}

# --- The trigger: buildpacks build, then Cloud Run deploy --------------------
#
# §5 Deployment writes location = "global"; a 2nd-generation repository is
# regional, and a trigger must sit in its repository's region, so this one is
# regional too.
resource "google_cloudbuild_trigger" "deploy" {
  project  = google_project.strava_bot.project_id
  name     = "strava-bot-deploy"
  location = var.region

  service_account = google_service_account.build.id

  repository_event_config {
    repository = google_cloudbuildv2_repository.app.id

    push {
      branch = "^${var.deploy_branch}$"
    }
  }

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

    # Google's native buildpacks — no Dockerfile (§10 Repository layout).
    step {
      name = "gcr.io/k8s-skaffold/pack"
      args = [
        "build",
        local.image,
        "--builder", "gcr.io/buildpacks/builder",
      ]
    }

    # pack leaves the image in the worker's Docker daemon, and the build-level
    # "images" list is only pushed once every step has finished — which is after
    # the deploy step below has already tried to pull it. So push it here.
    step {
      name = "gcr.io/cloud-builders/docker"
      args = ["push", "${local.image}:latest"]
    }

    # The only place gcloud appears, and only inside Cloud Build (ADR 0007).
    # Every flag below the image is a cost control, not a tuning knob
    # (§5 Deployment, Constraint 13).
    step {
      name       = "gcr.io/google.com/cloudsdktool/cloud-sdk:slim"
      entrypoint = "gcloud"
      args = [
        "run", "deploy", "strava-bot",
        "--project", var.project_id,
        "--image", "${local.image}:latest",
        "--region", var.region,
        "--service-account", google_service_account.run.email,
        "--allow-unauthenticated",
        "--max-instances", "3",
        "--concurrency", "4",
        "--memory", "512Mi",
        "--timeout", "120",
        "--set-env-vars", local.run_env_vars,
        "--set-secrets", local.run_secrets,
        "--quiet",
      ]
    }

    options {
      logging = "CLOUD_LOGGING_ONLY"
    }
  }
}

# Cloud Build owns the service, so Terraform reads the deployed URL back rather
# than declaring it. The data source 404s until the pipeline has run once, which
# would abort the very apply that creates the pipeline — hence the flag. Leave
# it at its default; pass -var=cloud_run_deployed=false only for the first apply
# against a project where the trigger has never run.
data "google_cloud_run_service" "strava_bot" {
  count = var.cloud_run_deployed ? 1 : 0

  project  = google_project.strava_bot.project_id
  name     = "strava-bot"
  location = var.region
}
