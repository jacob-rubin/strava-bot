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
    LLM_API_KEY          = "llm-api-key"
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
# the two whose first version is written elsewhere, which stay empty here with
# Terraform owning no version of them: STRAVA_REFRESH_TOKEN, written by T06's
# scripts/authorize.py and rewritten by the service on rotation, and
# LLM_API_KEY, which has no value until T22 chooses a provider.
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
