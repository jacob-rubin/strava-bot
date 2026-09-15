---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T03 — Create the Secret Manager secrets with Terraform

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | [T01](T01-strava-api-app.md), [T02](T02-gcp-project.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — the authoritative variable/source table
- [ADR 0001](../decisions/0001-static-bearer-secret.md) — why the ingest key is a static bearer secret
- [ADR 0007](../decisions/0007-terraform-for-gcp-infra.md) — secret resources in Terraform, versions outside VCS
- [Constraint 7](../CONSTRAINTS.md) — never log a secret

## Deliverable

Terraform (in `terraform/`) creates one Secret Manager secret per Secret-Manager-sourced row of [§9](../planning/07-config-and-repo-layout.md#9-configuration), each with one enabled version — except `STRAVA_REFRESH_TOKEN`, which is created empty here and populated by [T06](T06-authorize-script.md).

## Steps

1. In `terraform/`, declare a `google_secret_manager_secret` per Secret-Manager-sourced variable in [§9](../planning/07-config-and-repo-layout.md#9-configuration), using the secret names already referenced by the deploy config in [§5 Deployment](../planning/03-ingest-api.md#deployment).
2. Generate `INGEST_KEY` and `INGEST_PATH_TOKEN` as high-entropy random strings (≥32 bytes, URL-safe for the path token) via `random_password` resources, and create their `google_secret_manager_secret_version`s from those — never from a file that could be committed.
3. Create the `STRAVA_CLIENT_SECRET` version from `TF_VAR_strava_client_secret`, supplied at apply time from the environment.
4. Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` on all of them, plus `roles/secretmanager.secretVersionAdder` on the refresh-token secret — [§9](../planning/07-config-and-repo-layout.md#9-configuration) requires the latter for the rotation write-back in [Constraint 8](../CONSTRAINTS.md).
5. `terraform apply` with `TF_VAR_strava_client_secret` passed from the environment, never from a file that could be committed.

## Done when

```bash
cd terraform
terraform apply
terraform state list
```

Every Secret-Manager-sourced variable from [§9](../planning/07-config-and-repo-layout.md#9-configuration) appears as a `google_secret_manager_secret` in `terraform state list`, and every secret except the refresh-token secret has a `google_secret_manager_secret_version` in state.

## On completion

Flip `T03` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

