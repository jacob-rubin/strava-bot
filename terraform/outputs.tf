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
