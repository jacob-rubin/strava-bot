---
status: authoritative
last-updated: 2026-09-12
---

← [Index](../PLANNING.md)

## 1. Purpose

Post strength workouts logged in the Strong iOS app to Strava, automatically, with an LLM-generated title and description.

### Flow

```
Strong (iOS) → Share Workout (plain text)
  → Shortcut "Post to Strava" (share sheet)
    → POST /ingest/{path_token}   [raw text body]
      → Cloud Run service
         ├─ authenticate, validate, parse
         ├─ idempotency check
         ├─ persist raw + parsed
         ├─ generate title + description (LLM)
         └─ create Strava activity
      → plain-text status line, shown in an iOS notification
```

### In scope

- Parse Strong's share text into a structured workout.
- Idempotent HTTP ingest endpoint on Cloud Run.
- LLM-generated title and description from workout data.
- Create the Strava activity with that title and description.

### Explicitly out of scope

- **Images.** Strava's public API has no media upload endpoint. Do not implement image generation, hosting, or attachment. Do not add image URLs to the description.
- Apple Health / HealthKit ingest.
- Reading any data back from Strava (see [Strava integration §7.5](05-strava-integration.md#75-policy-constraint--non-negotiable)).
- Multi-user support. Single user, single Strava account, no user table.
- A native iOS app or Share Extension.

---

## 2. Prerequisites

| Requirement                | Notes                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active Strava subscription | **[V]** Required to create an API application.                                                                                                                        |
| Strava API application     | **[V]** Create at `https://www.strava.com/settings/api`. Yields `client_id`, `client_secret`. Set Authorization Callback Domain to `localhost` for the one-time auth. |
| GCP project                | Cloud Run (deployed by Cloud Build), Secret Manager, Firestore (native mode) — infrastructure declared in Terraform.                                                  |
| Terraform CLI              | Google provider; config lives in `terraform/` and is applied with `terraform apply` ([ADR 0007](../decisions/0007-terraform-for-gcp-infra.md)).                    |
| LLM API access             | Any provider. Isolated behind an interface ([§8](06-llm-generation.md)).                                                                                              |

---

← [Index](../PLANNING.md) · Next: [Input contract](02-input-contract.md)
