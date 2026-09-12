---
status: authoritative
last-updated: 2026-09-10
---

← [Index](../PLANNING.md)

## 9. Configuration

| Variable                       | Source         | Notes                        |
| ------------------------------ | -------------- | ---------------------------- |
| `INGEST_KEY`                   | Secret Manager |                              |
| `INGEST_PATH_TOKEN`            | Secret Manager | URL path segment             |
| `STRAVA_CLIENT_ID`             | env            | not secret                   |
| `STRAVA_CLIENT_SECRET`         | Secret Manager |                              |
| `STRAVA_REFRESH_TOKEN`         | Secret Manager | **written back** on rotation |
| `LLM_API_KEY`                  | Secret Manager |                              |
| `LOCAL_TZ`                     | env            | `America/Chicago`            |
| `STRAVA_USE_STRUCTURED_UPLOAD` | env            | default `false`              |
| `MAX_BODY_BYTES`               | env            | default `65536`              |
| `ELAPSED_CAP_S`                | env            | default `14400`              |

The service needs `roles/secretmanager.secretAccessor` and, for refresh-token rotation, `roles/secretmanager.secretVersionAdder`.

---

## 10. Repository layout

```
strava-bot/
  app/
    main.py                 # FastAPI, routes, processing order (§5)
    parser.py               # strong_share_parser.py
    models.py               # Workout, Exercise, WorkoutSet, summaries
    store.py                # Firestore: workouts, history
    llm.py                  # generate() — MUST NOT import strava.py
    strava.py               # tokens, create_activity, upload_structured
    config.py               # env + Secret Manager
  scripts/
    authorize.py            # one-time §7.2
    probe_upload_json.py    # §7.4 [U] probe
    reparse.py              # re-parse stored raw_text after parser changes
  tests/
    fixtures/*.txt          # share-text samples, incl. §3 fixture
    test_parser.py
    test_ingest.py
    test_boundaries.py      # import-boundary enforcement
  Dockerfile
  pyproject.toml
```

Python 3.12, FastAPI, `google-cloud-firestore`, `google-cloud-secret-manager`, `httpx`. No ORM.

---

← [Index](../PLANNING.md) · Previous: [Title and description generation](06-llm-generation.md) · Next: [Error handling](08-error-handling.md)
