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
