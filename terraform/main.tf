terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }

    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "gcs" {
    bucket = "strava-bot-508419-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google" {
  alias   = "billing"
  project = var.project_id
  region  = var.region

  billing_project       = var.project_id
  user_project_override = true
}

locals {
  secrets = {
    INGEST_KEY           = "strava-bot-ingest-key"
    INGEST_PATH_TOKEN    = "strava-bot-path-token"
    STRAVA_CLIENT_SECRET = "strava-client-secret"
    STRAVA_REFRESH_TOKEN = "strava-refresh-token"
  }

  rotated_secrets = ["STRAVA_REFRESH_TOKEN"]

  services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
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

resource "google_firestore_database" "default" {
  project     = google_project.strava_bot.project_id
  name        = "(default)"
  location_id = local.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.enabled]
}

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

resource "random_password" "ingest_key" {
  length  = 43
  special = false
}

resource "random_password" "ingest_path_token" {
  length  = 43
  special = false
}

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

resource "google_secret_manager_secret_version" "strava_client_secret" {
  secret      = google_secret_manager_secret.secrets["STRAVA_CLIENT_SECRET"].id
  secret_data = var.strava_client_secret
  enabled     = true
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = local.secrets

  project   = google_secret_manager_secret.secrets[each.key].project
  secret_id = google_secret_manager_secret.secrets[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "version_adder" {
  for_each = toset(local.rotated_secrets)

  project   = google_secret_manager_secret.secrets[each.value].project
  secret_id = google_secret_manager_secret.secrets[each.value].secret_id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_project_iam_member" "run_firestore" {
  project = google_project.strava_bot.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run.email}"
}

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

locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/strava-bot"

  run_secrets = join(",", [for env_var, secret in local.secrets : "${env_var}=${secret}:latest"])

  run_env_vars = join(",", [
    "STRAVA_CLIENT_ID=${var.strava_client_id}",
    "LOCAL_TZ=${var.local_tz}",
  ])
}

resource "google_artifact_registry_repository" "app" {
  project       = google_project.strava_bot.project_id
  location      = var.region
  repository_id = "strava-bot"
  format        = "DOCKER"
  description   = "Buildpacks images for the strava-bot Cloud Run service."

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "build" {
  project      = google_project.strava_bot.project_id
  account_id   = "strava-bot-build"
  display_name = "strava-bot Cloud Build pipeline"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "build" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/logging.logWriter",
    "roles/run.admin",
  ])

  project = google_project.strava_bot.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_service_account_iam_member" "build_uses_runtime_identity" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

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
        local.image,
        "--builder", "gcr.io/buildpacks/builder",
      ]
    }

    step {
      name = "gcr.io/cloud-builders/docker"
      args = ["push", "${local.image}:latest"]
    }

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

data "google_cloud_run_service" "strava_bot" {
  count = var.cloud_run_deployed ? 1 : 0

  project  = google_project.strava_bot.project_id
  name     = "strava-bot"
  location = var.region
}
