---
status: authoritative
last-updated: 2026-09-15
---

← [Index](PLANNING.md)

# Non-negotiable constraints

Every rule here is called out as mandatory somewhere in [PLANNING.md](PLANNING.md). This file exists so an agent editing `app/` can check itself in one pass instead of re-reading the whole spec. If a change would violate one of these, stop and re-read the linked section — don't route around it.

1. **The MVP has no AI/model integration.** Strava API Policy §5.3 forbids using Strava data in connection with AI training, evaluation, or operation (including RAG/grounding). The MVP therefore has no AI SDK, remote model call, prompt, or model credential. Any separately designed post-MVP enhancement must never receive Strava-originated data. → [Strava integration §7.5](planning/05-strava-integration.md)

2. **Request `activity:write` only; an additional returned `read` scope is allowed, and read endpoints may be called.** The one-time authorization URL requests `activity:write` — never a broader scope. Strava may return `read` alongside it in the callback (for example `scope=read,activity:write`); accept that grant. Calling a Strava read endpoint is permitted, in `app/` as well as in probes and `scripts/` ([ADR 0010](decisions/0010-allow-development-read-calls.md)). Two limits survive, and they are the non-negotiable part: no Strava-originated data may reach an AI component (rule 1), and a read payload must not land in an AI coding agent's context — write it to a gitignored file and quote only what you need. → [Strava integration §7.2](planning/05-strava-integration.md), [§7.5](planning/05-strava-integration.md#75-policy-constraint--non-negotiable), [ADR 0010](decisions/0010-allow-development-read-calls.md)

3. **Auth failures return 404 with an empty body, always.** Wrong `path_token` or wrong `X-Ingest-Key` — same response either way. Never 401, never a message that reveals which check failed, never log the supplied values. Compare fixed-length SHA-256 digests with Node's `crypto.timingSafeEqual`, never secrets with `===`. → [Ingest API §5](planning/03-ingest-api.md)

4. **Cheap rejections precede external writes.** Auth → size cap → parse → idempotency lookup, in that order, before any Strava call. → [Ingest API §5](planning/03-ingest-api.md)

5. **Never drop a line.** An unrecognized set payload is retained with `kind="unparsed"` and its raw text, not discarded. → [Input contract, parsing rule 9](planning/02-input-contract.md)

6. **Always persist `raw_text`, even when parsing fails.** This is what makes re-parsing after a parser fix possible. A 400 response still leaves a Firestore doc with `raw_text` populated. → [Persistence §6](planning/04-persistence.md), [Error handling §11](planning/08-error-handling.md)

7. **Never log `raw_text` or any secret.** → [Error handling §11](planning/08-error-handling.md)

8. **A rotated Strava refresh token must be persisted immediately.** The token-refresh response's `refresh_token` may differ from the one sent; write it as a new Secret Manager version whenever it changes. Losing a rotated token locks out the integration and requires redoing the one-time authorization by hand. → [Strava integration §7.3](planning/05-strava-integration.md)

9. **Activity text is local and deterministic.** The MVP title/description path must not depend on a provider, network call, prompt, credential, timeout, or fallback branch. → [Activity title and description formatting §8](planning/06-activity-text.md)

10. **Never invent data in the title/description.** If history context is empty, omit comparative claims entirely rather than guessing. PR detection is a code comparison against `history`; the formatter uses explicit booleans and never infers a PR. → [Activity title and description formatting §8](planning/06-activity-text.md)

11. **Don't post to Strava without a durable idempotency record.** If Firestore is unavailable, fail the request (500) rather than risk a duplicate post. → [Error handling §11](planning/08-error-handling.md)

12. **No background retry queue.** Retries are the user's job — tapping Share again is idempotent by construction (dedupe key + content-hash guard). Don't build automatic retry infrastructure. → [Error handling §11](planning/08-error-handling.md)

13. **`--max-instances=3` (in the Cloud Build deploy step) is a cost control, not a performance setting**, because the endpoint is public at the Cloud Run IAM layer and can consume compute. Pair any deployment change with a GCP billing budget alert, not just this flag. → [Ingest API — Deployment](planning/03-ingest-api.md#deployment)

14. **Out of scope, don't build toward it "for later":** image upload/generation (Strava's API has no media endpoint), HealthKit ingest, reading any data back from Strava, multi-user support, a native iOS app or Share Extension. → [Purpose §1](planning/01-purpose-and-prerequisites.md)

---

← [Index](PLANNING.md)
