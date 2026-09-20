variable "project_id" {
  description = "GCP project id to create and hold every strava-bot resource."
  type        = string
}

variable "project_name" {
  description = "Display name of the GCP project."
  type        = string
  default     = "strava-bot"
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry, and Cloud Build."
  type        = string
  default     = "us-central1"
}

variable "billing_account" {
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX) to link to the project."
  type        = string
}

variable "org_id" {
  description = "Parent organization id, or null for a project with no parent."
  type        = string
  default     = null
}

variable "folder_id" {
  description = "Parent folder id, or null for a project with no parent."
  type        = string
  default     = null
}

variable "firestore_location" {
  description = "Firestore location id; defaults to var.region when null."
  type        = string
  default     = null
}

variable "budget_amount" {
  description = "Monthly budget cap for the project, in var.budget_currency."
  type        = number
  default     = 10
}

variable "budget_currency" {
  description = "Currency of the budget cap; must match the billing account's."
  type        = string
  default     = "USD"
}

variable "budget_actual_thresholds" {
  description = "Actual-spend fractions of the cap that trigger an alert email."
  type        = list(number)
  default     = [0.5, 0.9, 1.0]
}

variable "strava_client_secret" {
  description = "Strava API application client secret; pass via TF_VAR_strava_client_secret."
  type        = string
  sensitive   = true
}

variable "strava_client_id" {
  description = "Strava API application client id; env, not a secret."
  type        = string
  default     = "278290"
}

variable "local_tz" {
  description = "LOCAL_TZ for the deployed service."
  type        = string
  default     = "America/Chicago"
}

variable "github_repo_uri" {
  description = "Clone URL of the repository the Cloud Build trigger builds."
  type        = string
  default     = "https://github.com/jacob-rubin/strava-bot.git"
}

variable "deploy_branch" {
  description = "Branch whose pushes run the deploy trigger."
  type        = string
  default     = "main"
}

variable "github_app_installation_id" {
  description = "Installation id of the Cloud Build GitHub App on the repo; pass via TF_VAR_github_app_installation_id."
  type        = number
}

variable "github_token" {
  description = "GitHub personal access token authorizing the Cloud Build connection; pass via TF_VAR_github_token."
  type        = string
  sensitive   = true
}

variable "cloud_run_deployed" {
  description = "Whether the Cloud Build pipeline has already deployed the Cloud Run service."
  type        = bool
  default     = true
}
