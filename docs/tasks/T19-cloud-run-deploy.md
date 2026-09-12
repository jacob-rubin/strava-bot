---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T19 — Deploy to Cloud Run with a budget alert

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T03](T03-secret-manager-secrets.md), [T17](T17-ingest-and-boundary-tests.md), [T18](T18-dockerfile-local-run.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§5 Deployment](../planning/03-ingest-api.md#deployment) — the exact deploy command and why `--allow-unauthenticated` is required
- [Constraint 13](../CONSTRAINTS.md) — `--max-instances=3` is a cost control and must be paired with a billing budget alert

## Deliverable

No repo change beyond a recorded service URL. In GCP: a deployed Cloud Run service and a billing budget alert.

## Steps

1. Deploy with the command in [§5 Deployment](../planning/03-ingest-api.md#deployment), unchanged — the flags are cost controls, not tuning knobs.
2. Bind every Secret-Manager-sourced variable from [§9](../planning/07-config-and-repo-layout.md#9-configuration), not only the three shown inline in the example.
3. Create a GCP billing budget with an alert threshold before sharing the URL anywhere ([Constraint 13](../CONSTRAINTS.md)).
4. Record the service URL and the `path_token` form of the ingest URL for [T21](T21-shortcut-wiring-e2e.md). Do not paste the key or token into the repo.

## Done when

```bash
gcloud run services describe strava-bot --format="value(status.url,spec.template.spec.containerConcurrency)"
curl -s "$(gcloud run services describe strava-bot --format='value(status.url)')/healthz"
gcloud billing budgets list --billing-account=<ACCOUNT_ID>
```

`/healthz` returns `ok` over HTTPS, max instances reads 3, and at least one budget is listed.

## On completion

Flip `T19` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

