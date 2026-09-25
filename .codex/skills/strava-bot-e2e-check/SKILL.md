---
name: strava-bot-e2e-check
description: Run a live end-to-end sanity check of the deployed strava-bot service by posting a Strong fixture to its /ingest endpoint and interpreting the result. Use to confirm that a deploy, a re-authorization, or a fix actually works in production. Not for root-causing failures from logs, and not for the local unit-test suite.
---

# Strava bot end-to-end check

Confirms the deployed service end to end — auth gate, parser, Firestore, formatting, Strava — by sending a real payload to the live Cloud Run endpoint exactly as the iPhone Shortcut would.

```bash
tools/post-fixture.sh --fresh
```

Flags: `--fixture <name>` picks any file under `tests/fixtures` (an unknown name lists them), `--dry-run` prints the exact payload and sends nothing, `--ingest-url` overrides the endpoint, and `--help` lists them all.

## Live by default

Invoking this skill is the request for a live post: run the command above straight away, without a preliminary dry run and without asking for confirmation. A successful run **creates a real Strava activity** on the owner's account, so say so in the report and give the activity URL so it can be deleted if unwanted.

Use `--dry-run` only when the user asks for one. It reads no credential and sends nothing.

The script resolves the ingest URL from local Terraform state, which exists only in the main checkout, not in a Codex worktree. From a worktree, read `terraform output -raw ingest_url` in the main checkout's `terraform/` directory into an exported `STRAVA_BOT_INGEST_URL` within the same command, without printing it, and then run the script.

For the read-only check that the auth gate still rejects unknown callers, use `tools/probe-auth.sh` instead.

## Why --fresh matters

The service dedupes on two independent keys: the share-link slug, and a `content_hash` over `started_at` plus each exercise name and set count. Randomizing the slug alone is not enough — the content-hash lookup still matches and the service returns `already posted`.

`--fresh` rewrites the slug *and* the date line to now, which is what makes a repeat run a genuinely new workout. Without it, `already posted` on a second run is correct idempotent behaviour, not a failure.

## Reading the result

| Status | Meaning |
| --- | --- |
| 200 `posted:` | Worked. The printed URL is the new activity. |
| 200 `already posted:` | Deduped. Re-run with `--fresh`. |
| 400 | Parse failure. `raw_text` was still persisted, so the fixture can be re-parsed after a parser fix. |
| 404 | Auth gate. Wrong path_token or X-Ingest-Key; by design the response never says which. |
| 500 | Firestore. Nothing reached Strava. |
| 502 | The request reached Strava and Strava refused it. |

On 502, read `strava_status` in the Cloud Run request log record: 401 is a token or scope problem, 400 a payload problem, 429 a rate limit. A 401 whose `strava_failure_stage` is `create_activity` means the OAuth refresh succeeded and the write was still refused — that is a missing `activity:write` scope on the stored refresh token, not an expired token.

## When a fix appears not to take effect

Two different things must reach production, and the second is easy to miss.

Code changes ship only in a new revision. Pushing to `main` fires the `strava-bot-deploy` Cloud Build trigger.

A new refresh-token secret version may need **new instances**. `SecretManagerSecretAccessor` in `app/config.ts` caches each secret in-process for the life of the instance, so a warm instance can keep serving the token it first read.

Since the 401 path re-reads the refresh token through `reloadStravaRefreshToken` (bypassing that cache), an instance holding a superseded token now recovers on its next failed call — whether it was superseded by a re-authorization or by a rotation another instance persisted. Expect self-healing on the retry rather than a permanent failure.

If the deployed revision predates that behaviour, the old rule applies: re-authorize first, then redeploy, because redeploying first just caches the old token again. To get new instances without a rebuild:

```bash
gcloud run services update strava-bot --region us-central1 --project strava-bot-508419 --update-env-vars=REDEPLOY_AT=$(date +%Y-%m-%dT%H:%M:%S)
```

## Handling secrets

The script reads the path_token from `terraform output -raw ingest_url` and the ingest key from Secret Manager into variables and prints neither, so its output is safe to paste into an issue or an agent context. Keep it that way: do not echo the resolved URL or key, and prefer the `STRAVA_BOT_INGEST_URL` / `STRAVA_BOT_INGEST_KEY` environment variables over flags so the token stays out of shell history.

Do not wrap the script in an `npm run` alias. npm parses `--fresh` and `--dry-run` as its own config flags and silently drops them, which turns an intended dry run into a real post.

## Deeper diagnosis

This skill confirms whether the service works. To root-cause a failure from Cloud Run logs, use the `review-strava-bot-cloud-run-logs` skill, which is read-only and produces a redacted RCA.
