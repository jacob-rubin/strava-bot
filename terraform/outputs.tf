output "project_id" {
  description = "The project every strava-bot resource lives in."
  value       = google_project.strava_bot.project_id
}

output "project_number" {
  description = "Project number, used by Cloud Build's default service account."
  value       = google_project.strava_bot.number
}

output "region" {
  description = "Region T19's Cloud Build trigger deploys Cloud Run into."
  value       = var.region
}

output "firestore_location" {
  description = "Location of the native-mode Firestore database."
  value       = google_firestore_database.default.location_id
}

output "runtime_service_account" {
  description = "Cloud Run runtime service account the deploy step runs as."
  value       = google_service_account.run.email
}

output "secret_ids" {
  description = "Secret Manager secret name per env var of §9 Configuration."
  value       = { for env_var, secret in google_secret_manager_secret.secrets : env_var => secret.secret_id }
}

output "monthly_budget" {
  description = "Monthly billing budget guarding the public, paid endpoint."
  value       = "${var.budget_amount} ${var.budget_currency} (${google_billing_budget.monthly.display_name})"
}

output "deploy_trigger" {
  description = "Cloud Build trigger that builds with buildpacks and deploys Cloud Run."
  value       = "${google_cloudbuild_trigger.deploy.name} (${google_cloudbuild_trigger.deploy.location})"
}

output "build_service_account" {
  description = "Identity the deploy pipeline runs as."
  value       = google_service_account.build.email
}

# Empty until the trigger has run; see var.cloud_run_deployed.
output "service_url" {
  description = "HTTPS URL of the Cloud Run service the pipeline deployed."
  value       = try(data.google_cloud_run_service.strava_bot[0].status[0].url, "")
}

# The path_token form of the ingest endpoint, for T21's Shortcut. Sensitive
# because the token is half of the endpoint's authentication (Constraint 3):
# read it with `terraform output -raw ingest_url`, never paste it into the repo.
output "ingest_url" {
  description = "POST target for the Shortcut, including the path_token segment."
  value       = "${try(data.google_cloud_run_service.strava_bot[0].status[0].url, "")}/ingest/${random_password.ingest_path_token.result}"
  sensitive   = true
}
