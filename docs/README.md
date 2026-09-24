# Strava Bot — documentation

Post strength workouts logged in the [Strong](https://www.strongapp.io/) iOS app to Strava
automatically, with a deterministic title and description derived from the workout.

The service is built, deployed, and in use. These documents describe what it does today.

## Map

| Document | What it covers |
| -------- | -------------- |
| [CONSTRAINTS.md](CONSTRAINTS.md) | Non-negotiable rules. Read in full before editing `app/`. |
| [architecture.md](architecture.md) | System context, GCP resource map, request path, data model, cost posture. |
| [operations.md](operations.md) | Deploying, secrets, authorization, the iOS Shortcut, re-parsing, live checks. |
| [reference/input-contract.md](reference/input-contract.md) | Strong share-text grammar, parsing rules, set variants, derived values. |
| [reference/ingest-api.md](reference/ingest-api.md) | The ingest endpoint: auth, processing order, responses, error handling, logging. |
| [reference/persistence.md](reference/persistence.md) | Firestore `workouts` and `history`, dedupe, the activity-text data model. |
| [reference/strava.md](reference/strava.md) | OAuth and token rotation, the structured upload path, the exercise-type map, policy, rate limits. |
| [reference/activity-text.md](reference/activity-text.md) | The deterministic title and description formatter. |
| [reference/configuration.md](reference/configuration.md) | Environment variables, secrets, repository layout, toolchain. |
| [reference/style-rules.md](reference/style-rules.md) | TypeScript style rules for new and changed code, applied by `code-cleanup`. |
| [decisions/](decisions/README.md) | ADRs — why a choice was made, kept separately from what the code does. |

## Scope

In scope: parsing Strong's share text, an idempotent HTTP ingest endpoint on Cloud Run,
deterministic activity text, and creating the Strava activity.

Out of scope, and not to be built toward:

- **Images.** Strava's public API has no media upload endpoint. No image generation, hosting,
  attachment, or image URLs in the description.
- Apple Health / HealthKit ingest.
- Multi-user support. One user, one Strava account, no user table.
- A native iOS app or Share Extension.
- AI-generated titles or descriptions (see [Constraint 1](CONSTRAINTS.md)).

## Known unknowns

Three questions are open. None blocks anything, and each has a mitigation already in the code.

- **Is the `link.strong.app` slug stable across repeated shares?** Unverified. It does not
  matter: every workout also stores a `content_hash`, and the idempotency lookup falls back to
  it, so dedupe stays correct either way ([persistence](reference/persistence.md)).
- **Are there set formats beyond the known variants?** Ongoing by nature — Strong can log
  movements this parser has not seen. An unrecognized payload is retained as `kind="unparsed"`
  with its raw text and never dropped, and `scripts/reparse.ts` re-parses stored `raw_text`
  after a parser change to find them ([operations](operations.md#re-parsing-stored-workouts)).
- **Would AI-generated activity text be worth adding?** Deferred indefinitely. Strava's API
  policy forbids Strava data reaching an AI application, so any future design must keep the
  deterministic formatter as the complete default path and must never receive Strava-originated
  data ([Constraint 1](CONSTRAINTS.md), [reference/strava.md](reference/strava.md#policy-constraint)).
