---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T18 — `Dockerfile` and a local container run

|            |     |
| ---------- | --- |
| Phase      | [§13 step 3](../planning/10-build-order-and-client.md#13-build-order) — ingest v1 |
| Depends on | [T16](T16-ingest-endpoint.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§10 Repository layout](../planning/07-config-and-repo-layout.md#10-repository-layout) — runtime and dependency set
- [§5 Deployment](../planning/03-ingest-api.md#deployment) — the port and timeout the image must satisfy

## Deliverable

- `Dockerfile` — Python 3.12 image serving `app.main:app`, honouring `$PORT`

## Steps

1. Base on a slim Python 3.12 image and install only what [§10](../planning/07-config-and-repo-layout.md#10-repository-layout) lists.
2. Run as a non-root user and bind to `$PORT` with a default of 8080, as Cloud Run requires.
3. Copy `app/` only — `scripts/` and `tests/` are not part of the runtime image.
4. Build and run locally with the [§9](../planning/07-config-and-repo-layout.md#9-configuration) variables supplied as environment variables, using dummy secrets.

## Done when

```bash
docker build -t strava-bot .
docker run --rm -p 8080:8080 -e PORT=8080 strava-bot &
curl -s localhost:8080/healthz
```

Prints `ok`.

## On completion

Flip `T18` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

