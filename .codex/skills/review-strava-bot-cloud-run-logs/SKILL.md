---
name: review-strava-bot-cloud-run-logs
description: Review Cloud Run logs, debug output, and runtime errors for the strava-bot service; produce a redacted RCA and proposed fixes without changing production or repository code.
---

# Review Strava Bot Cloud Run logs

Use this skill to diagnose the deployed `strava-bot` service when asked to inspect its Cloud Run logs, debug output, errors, or likely root cause. It is a read-only review skill: report findings and proposed fixes, but do not edit code, deploy a revision, change Cloud Run configuration, or modify GCP resources.

## Target and access

Use the authenticated Google Cloud CLI. Always pass these values explicitly rather than relying on the active gcloud configuration:

- project: `strava-bot-508419`
- service: `strava-bot`
- region: `us-central1`

If the request does not specify a time range, review the last 24 hours. State the effective range in the report. If access fails, report the failed read-only command and the missing permission or authentication step; do not attempt to change credentials or IAM.

## Collect bounded evidence

Start by inspecting service health and revisions without printing environment values:

```powershell
gcloud run services describe strava-bot --project strava-bot-508419 --region us-central1 --format='yaml(metadata.generation,status.url,status.conditions,status.latestReadyRevisionName,status.traffic)'
gcloud run revisions list --service strava-bot --project strava-bot-508419 --region us-central1 --limit=20
```

Query Cloud Logging with a filter anchored to the Cloud Run revision resource and this service. Review `severity>=ERROR` first, then inspect nearby debug, request, stdout, and stderr events needed to explain each incident. Use a hard limit of 250 entries per query. Treat a query that reaches its limit as incomplete: narrow or divide the requested period into smaller windows until the relevant failures and context are covered, and disclose any remaining incomplete coverage.

Use an explicit project and a bounded `--freshness` or timestamp filter. For example, a default-window error query is:

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="strava-bot" AND resource.labels.location="us-central1" AND severity>=ERROR' --project strava-bot-508419 --freshness=24h --limit=250 --order=asc --format=json
```

For a precise incident window, replace `--freshness` with inclusive UTC `timestamp` bounds. Do not use unscoped project-wide log searches.

## Analyze and report

Group duplicate events, identify the affected revision and first/last occurrence, and correlate failures with request logs, debug output, and recent revision changes. Distinguish evidence from inference. Do not claim a root cause when logs only establish a symptom.

Return, in priority order:

1. The review window, query coverage, and service/revision health context.
2. A concise error summary: signature, count or recurrence, affected revision, and impact where supported.
3. An RCA for each meaningful issue, including evidence, confidence, and unresolved questions.
4. Proposed fixes only: the affected code or configuration area, the smallest safe change, and a concrete verification step. Clearly mark suggestions that need more evidence.
5. A short healthy/no-action-needed conclusion when no meaningful errors are found.

## Data and safety boundaries

- Never retrieve Secret Manager values, supplied authentication values, tokens, API keys, or environment-variable values. Never echo any credential that appears unexpectedly in a log.
- `raw_text` and other workout content may appear because debug raw-text logging is enabled by default. Use it only to understand parser or request-shape failures; summarize or redact it in the report. Do not reproduce it unless the owner explicitly asks for the exact content.
- Do not send Strava-originated data to an AI component. Do not inspect Strava read payloads as part of this workflow.
- Do not apply a proposed fix. A separate explicit request is required to change code, configuration, secrets, deployments, or log retention.
