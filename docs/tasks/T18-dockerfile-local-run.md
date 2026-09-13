---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T18 — Buildpacks build and local run

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T16](T16-ingest-endpoint.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§10 Repository layout](../planning/07-config-and-repo-layout.md#10-repository-layout) — runtime and dependency set; no `Dockerfile`
- [§5 Deployment](../planning/03-ingest-api.md#deployment) — the buildpacks build and the port/timeout the service must satisfy

## Deliverable

- A buildpack-buildable app with no `Dockerfile`: a Node.js 24 LTS project whose compiled npm `start` command serves Fastify on `$PORT` (default 8080).

## Steps

1. Keep the project buildable by Google's native Node.js buildpack: commit `package-lock.json`, keep the dependency set and npm scripts aligned with [§10](../planning/07-config-and-repo-layout.md#10-repository-layout), and do not add a `Dockerfile`.
2. Bind to `$PORT` with a default of 8080, as Cloud Run requires.
3. Build locally with `pack` and Google's buildpacks builder to confirm the image builds, then run the app locally with the [§9](../planning/07-config-and-repo-layout.md#9-configuration) variables supplied as environment variables, using dummy secrets.

## Done when

```bash
pack build --builder=gcr.io/buildpacks/builder strava-bot
PORT=8080 npm start &
curl -s localhost:8080/healthz
```

`pack build` produces an image, and `/healthz` prints `ok`.

## On completion

Flip `T18` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

