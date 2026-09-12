---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T03 — Create the Secret Manager secrets

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | [T01](T01-strava-api-app.md), [T02](T02-gcp-project.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — the authoritative variable/source table
- [ADR 0001](../decisions/0001-static-bearer-secret.md) — why the ingest key is a static bearer secret
- [Constraint 7](../CONSTRAINTS.md) — never log a secret

## Deliverable

No repo change. In GCP: one secret per Secret-Manager-sourced row of [§9](../planning/07-config-and-repo-layout.md#9-configuration), each with one enabled version. `STRAVA_REFRESH_TOKEN` is created empty here and populated by [T06](T06-authorize-script.md).

## Steps

1. Create a secret for each Secret-Manager-sourced variable in [§9](../planning/07-config-and-repo-layout.md#9-configuration), using the secret names already referenced by the deploy command in [§5 Deployment](../planning/03-ingest-api.md#deployment).
2. Generate `INGEST_KEY` and `INGEST_PATH_TOKEN` as high-entropy random strings (≥32 bytes, URL-safe for the path token). Add them as versions from stdin, never from a file that could be committed.
3. Add `STRAVA_CLIENT_SECRET` from [T01](T01-strava-api-app.md) and `LLM_API_KEY` from the chosen provider.
4. Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` on all of them, plus `roles/secretmanager.secretVersionAdder` on the refresh-token secret — [§9](../planning/07-config-and-repo-layout.md#9-configuration) requires the latter for the rotation write-back in [Constraint 8](../CONSTRAINTS.md).

## Done when

```bash
gcloud secrets list
gcloud secrets versions list strava-bot-ingest-key
```

Every Secret-Manager-sourced variable from [§9](../planning/07-config-and-repo-layout.md#9-configuration) is listed, and each except the refresh-token secret has at least one `enabled` version.

## On completion

Flip `T03` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

