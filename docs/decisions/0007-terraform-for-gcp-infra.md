---
status: authoritative
last-updated: 2026-09-12
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0007 — Terraform for GCP infrastructure; Cloud Build for Cloud Run

**Context.** Provisioning GCP resources (project/APIs, Firestore, Secret Manager, Cloud Run, IAM, billing budget) was previously documented as ad-hoc `gcloud` CLI commands (`gcloud run deploy`, `gcloud services enable`, `gcloud secrets ...`).

**Decision.** Terraform (from `terraform/`, applied with `terraform apply`) declares everything **except the Cloud Run service itself**: the project, the enabled APIs, the native-mode Firestore database, the Secret Manager secrets and their IAM bindings, the Cloud Run runtime service account, the billing budget, and the Cloud Build pipeline. The Cloud Run service is **deployed by that Cloud Build pipeline**, not defined as a Terraform resource. The `gcloud` CLI is not run on the developer's machine to create or update resources; it appears only as the Cloud Build deploy step's entrypoint, and may be used locally for read-only inspection.

- Terraform declares the project, the enabled APIs, the native-mode Firestore database, the Secret Manager secrets and their IAM bindings, the Cloud Run runtime service account, the `google_cloudbuild_trigger` (buildpacks build + Cloud Run deploy), and the `google_billing_budget`.
- The Cloud Run service is **not** a Terraform resource. The Cloud Build pipeline (declared in Terraform) builds the image with **Google's native buildpacks** (no Dockerfile) and deploys Cloud Run with the non-negotiable settings.
- Secret Manager **secret resources and IAM** are Terraform-managed. The sensitive **versions** are supplied at apply time from `TF_VAR_*` environment variables (or `random_password` for generated keys), never committed; `STRAVA_REFRESH_TOKEN` versions are still written by `scripts/authorize.py` via the Secret Manager client.
- **One bootstrap exception to the no-local-`gcloud` rule:** the GCS bucket holding the remote state. It has to exist before the state that would record it, so it is created once by hand with `gcloud storage buckets create` (versioned, uniform bucket-level access, public access prevented) and is deliberately **not** declared in Terraform. Everything else, including API enablement, stays Terraform-managed — never the Console, never a local `gcloud` mutation.

**Consequences.** Infrastructure is reproducible and reviewable. The non-negotiable Cloud Run settings (max 3 instances, concurrency 4, 512 Mi, 120 s timeout, unauthenticated ingress) live in the Cloud Build deploy step that Terraform declares, and Cloud Run is recreated/updated by the pipeline rather than by Terraform. Trade-offs: `terraform.tfstate` may contain secret material (secret versions), so keep it out of VCS and prefer a remote backend; and Terraform reads the deployed Cloud Run URL back through a `data` source instead of owning the service. This supersedes the `gcloud`-CLI wording in [§5 Deployment](../planning/03-ingest-api.md#deployment) and tasks [T02](../tasks/T02-gcp-project.md), [T03](../tasks/T03-secret-manager-secrets.md), [T06](../tasks/T06-authorize-script.md), [T18](../tasks/T18-dockerfile-local-run.md), and [T19](../tasks/T19-cloud-run-deploy.md).

→ [Ingest API §5](../planning/03-ingest-api.md) · [Repository layout §10](../planning/07-config-and-repo-layout.md#10-repository-layout)
