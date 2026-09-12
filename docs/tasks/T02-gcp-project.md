---
status: task
last-updated: 2026-09-12
---

← [Task index](README.md) · [Status](../STATUS.md)

# T02 — Stand up the GCP project with Terraform

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | — |
| Executor   | agent + human step |
| Blocked by | — |

## Read first

- [§2 Prerequisites](../planning/01-purpose-and-prerequisites.md#2-prerequisites)
- [§5 Deployment](../planning/03-ingest-api.md#deployment) — the Terraform-managed resources and the Cloud Build pipeline that deploys Cloud Run
- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — the service account roles this project must be able to grant
- [ADR 0007](../decisions/0007-terraform-for-gcp-infra.md) — why Terraform for infra and Cloud Build for Cloud Run
- [Constraint 13](../CONSTRAINTS.md) — the budget alert is part of deployment, not optional

## Deliverable

A `terraform/` directory that declares the project, the enabled APIs, the native-mode Firestore database, the Secret Manager secrets and their IAM bindings, and the Cloud Run runtime service account — applied successfully with `terraform apply` (the Cloud Build trigger, Cloud Run deploy, and billing budget are added in [T19](T19-cloud-run-deploy.md)).

## Steps

1. Scaffold `terraform/` with a Google provider configured for the chosen project and region; gitignore `terraform.tfstate` and any `*.tfvars` ([ADR 0007](../decisions/0007-terraform-for-gcp-infra.md)).
2. Declare the project and enable the Cloud Run, Secret Manager, Firestore, Cloud Build, and Artifact Registry APIs.
3. Declare the Firestore database in **native mode** — [§6](../planning/04-persistence.md#6-persistence) assumes native mode, not Datastore mode.
4. Declare the Secret Manager secrets for every Secret-Manager-sourced row of [§9](../planning/07-config-and-repo-layout.md#9-configuration), plus the Cloud Run runtime service account and its `secretmanager.secretAccessor` / `secretmanager.secretVersionAdder` bindings (versions are added in [T03](T03-secret-manager-secrets.md)).
5. Human step: run `terraform plan`, review it, then `terraform apply` with `TF_VAR_project_id` and `TF_VAR_region` set. Record the project id and region in `terraform.tfvars` (gitignored) or `variables.tf` defaults; [T03](T03-secret-manager-secrets.md) and [T19](T19-cloud-run-deploy.md) reuse them.

## Done when

```bash
cd terraform
terraform apply
terraform state list
```

Observable: `terraform state list` shows the enabled APIs, the Firestore database in native mode, the Secret Manager secrets, the service account, and its IAM bindings.

## On completion

Flip `T02` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)
