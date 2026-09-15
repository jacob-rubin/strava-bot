---
status: task
last-updated: 2026-09-14
---

← [Task index](README.md) · [Status](../STATUS.md)

# T19 — Deploy to Cloud Run via Cloud Build with a budget alert

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T03](T03-secret-manager-secrets.md), [T17](T17-ingest-tests.md), [T18](T18-dockerfile-local-run.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§5 Deployment](../planning/03-ingest-api.md#deployment) — the Cloud Build pipeline (buildpacks) and the non-negotiable Cloud Run settings
- [ADR 0007](../decisions/0007-terraform-for-gcp-infra.md) — Cloud Run is deployed by Cloud Build; Terraform declares everything else
- [Constraint 13](../CONSTRAINTS.md) — `--max-instances=3` is a cost control and must be paired with a billing budget alert

## Deliverable

A `terraform/` change that adds the `google_cloudbuild_trigger` (buildpacks build + Cloud Run deploy) and `google_billing_budget` on top of the resources applied in [T02](T02-gcp-project.md) and [T03](T03-secret-manager-secrets.md), plus a recorded service URL. The Cloud Run service itself is created by the pipeline, not as a Terraform resource.

## Steps

1. Add the `google_cloudbuild_trigger` from [§5 Deployment](../planning/03-ingest-api.md#deployment), unchanged — it builds with Google's native buildpacks (no `Dockerfile`) and deploys Cloud Run with the settings in [§5](../planning/03-ingest-api.md#deployment), which are cost controls, not tuning knobs.
2. Ensure the deploy step binds every Secret-Manager-sourced variable from [§9](../planning/07-config-and-repo-layout.md#9-configuration), not only the three shown inline in the example.
3. Add a `google_billing_budget` with an alert threshold before sharing the URL anywhere ([Constraint 13](../CONSTRAINTS.md)).
4. `terraform apply`, run the trigger (push to the configured branch, or the Console "Run" button), then `terraform apply` again to refresh the `service_url` data source. Record the service URL and the `path_token` form of the ingest URL for [T21](T21-shortcut-wiring-e2e.md). Do not paste the key or token into the repo.

## Done when

```bash
cd terraform
terraform apply
terraform state list
# run the trigger (push to the configured branch, or the Console "Run" button), then:
terraform apply
terraform output -raw service_url
curl -s "$(terraform output -raw service_url)/healthz"
```

`terraform state list` shows the `google_cloudbuild_trigger` and the `google_billing_budget`; after the trigger runs, `terraform output -raw service_url` is non-empty and `/healthz` returns `ok` over HTTPS.

## On completion

Flip `T19` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

