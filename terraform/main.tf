# strava-bot GCP infrastructure (T02).
#
# Terraform declares everything except the Cloud Run service itself, which the
# Cloud Build pipeline deploys; the gcloud CLI is never run locally to create or
# update resources (docs/decisions/0007-terraform-for-gcp-infra.md).
# The google_cloudbuild_trigger and google_billing_budget are added by T19.
#
# terraform.tfstate can contain secret material once T03 adds secret versions,
# so it stays out of VCS (see .gitignore); prefer a remote backend (ADR 0007).

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  # The Secret-Manager-sourced rows of §9 Configuration, keyed by the env var
  # the service reads. Values are the secret names the Cloud Build deploy step
  # in §5 Deployment already references. Versions are created by T03;
  # STRAVA_REFRESH_TOKEN is populated by scripts/authorize.py (T06) and
  # rewritten by the service on rotation (Constraint 8).
  secrets = {
    INGEST_KEY           = "strava-bot-ingest-key"
    INGEST_PATH_TOKEN    = "strava-bot-path-token"
    STRAVA_CLIENT_SECRET = "strava-client-secret"
    STRAVA_REFRESH_TOKEN = "strava-refresh-token"
    LLM_API_KEY          = "llm-api-key"
  }

  # Secrets the running service writes new versions of.
  rotated_secrets = ["STRAVA_REFRESH_TOKEN"]

  services = [
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
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

# §9: the service reads every secret above at startup.
resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = google_secret_manager_secret.secrets

  project   = each.value.project
  secret_id = each.value.secret_id
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
