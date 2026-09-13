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

# Sensitive secret material (T03), supplied at apply time from the environment
# as TF_VAR_strava_client_secret. It has no default on purpose: a default would
# invite a committed *.tfvars file, which ADR 0007 forbids for secret versions.
# §9's LLM_API_KEY has no matching variable — its secret is created empty and
# gets its first version when T22 picks a provider.
variable "strava_client_secret" {
  description = "Strava API application client secret from T01; pass via TF_VAR_strava_client_secret."
  type        = string
  sensitive   = true
}
