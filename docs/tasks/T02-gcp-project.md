---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T02 — Stand up the GCP project and enable APIs

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | — |
| Executor   | human |
| Blocked by | — |

## Read first

- [§2 Prerequisites](../planning/01-purpose-and-prerequisites.md#2-prerequisites)
- [§9 Configuration](../planning/07-config-and-repo-layout.md#9-configuration) — the service account roles this project must be able to grant
- [Constraint 13](../CONSTRAINTS.md) — the budget alert is part of deployment, not optional

## Deliverable

No repo change. Out of band: a GCP project with Cloud Run, Secret Manager, and Firestore (native mode) available, and `gcloud` on this machine pointed at it.

## Steps

1. Create or choose the project and set it as the active `gcloud` configuration.
2. Enable the Cloud Run, Secret Manager, Firestore, Cloud Build, and Artifact Registry APIs.
3. Create the Firestore database in **native mode** — [§6](../planning/04-persistence.md#6-persistence) assumes native mode, not Datastore mode.
4. Record the project id and region; every later `gcloud` invocation in [T03](T03-secret-manager-secrets.md) and [T19](T19-cloud-run-deploy.md) uses them.

## Done when

```bash
gcloud config get-value project
gcloud services list --enabled --filter="run.googleapis.com OR secretmanager.googleapis.com OR firestore.googleapis.com"
gcloud firestore databases describe --database="(default)"
```

Observable: the three services appear as enabled and the database describes with `type: FIRESTORE_NATIVE`.

## On completion

Flip `T02` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)
