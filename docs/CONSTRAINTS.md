---
status: authoritative
last-updated: 2026-09-13
---

← [Index](PLANNING.md)

# Non-negotiable constraints

Every rule here is called out as mandatory somewhere in [PLANNING.md](PLANNING.md). This file exists so an agent editing `app/` can check itself in one pass instead of re-reading the whole spec. If a change would violate one of these, stop and re-read the linked section — don't route around it.

1. **No Strava data ever reaches the LLM.** Strava API Policy §5.3 forbids using Strava data in connection with AI training, evaluation, or operation (including RAG/grounding). `app/llm.ts` must not import `app/strava.ts`, and must not accept any value returned by it — not `activity_id`, not upload status, not error strings. Enforced by `tests/test_boundaries.ts`. → [Strava integration §7.5](planning/05-strava-integration.md)

2. **Request `activity:write` only — no read scope.** This makes constraint 1 structurally true (no Strava data can be fetched at all), not just a code convention. → [Strava integration §7.2](planning/05-strava-integration.md)

3. **Auth failures return 404 with an empty body, always.** Wrong `path_token` or wrong `X-Ingest-Key` — same response either way. Never 401, never a message that reveals which check failed, never log the supplied values. Compare fixed-length SHA-256 digests with Node's `crypto.timingSafeEqual`, never secrets with `===`. → [Ingest API §5](planning/03-ingest-api.md)

4. **Cheap rejections precede all paid work.** Auth → size cap → parse → idempotency lookup, in that order, before any LLM or Strava call. → [Ingest API §5](planning/03-ingest-api.md)

5. **Never drop a line.** An unrecognized set payload is retained with `kind="unparsed"` and its raw text, not discarded. → [Input contract, parsing rule 9](planning/02-input-contract.md)

6. **Always persist `raw_text`, even when parsing fails.** This is what makes re-parsing after a parser fix possible. A 400 response still leaves a Firestore doc with `raw_text` populated. → [Persistence §6](planning/04-persistence.md), [Error handling §11](planning/08-error-handling.md)

7. **Never log `raw_text` or any secret.** → [Error handling §11](planning/08-error-handling.md)

8. **A rotated Strava refresh token must be persisted immediately.** The token-refresh response's `refresh_token` may differ from the one sent; write it as a new Secret Manager version whenever it changes. Losing a rotated token locks out the integration and requires redoing the one-time authorization by hand. → [Strava integration §7.3](planning/05-strava-integration.md)

9. **An LLM failure must never cost the user their activity.** On any LLM error or timeout (10s), fall back to a templated title/description generated from parsed data and post anyway. → [Title and description generation §8](planning/06-llm-generation.md)

10. **Never invent data in the title/description.** If history context is empty, omit comparative claims entirely rather than guessing. PR detection is a code comparison against `history`, passed to the model as explicit booleans — not something the model computes itself. → [Title and description generation §8](planning/06-llm-generation.md)

11. **Don't post to Strava without a durable idempotency record.** If Firestore is unavailable, fail the request (500) rather than risk a duplicate post. → [Error handling §11](planning/08-error-handling.md)

12. **No background retry queue.** Retries are the user's job — tapping Share again is idempotent by construction (dedupe key + content-hash guard). Don't build automatic retry infrastructure. → [Error handling §11](planning/08-error-handling.md)

13. **`--max-instances=3` (in the Cloud Build deploy step) is a cost control, not a performance setting**, because the endpoint is public and invokes a paid model. Pair any deployment change with a GCP billing budget alert, not just this flag. → [Ingest API — Deployment](planning/03-ingest-api.md#deployment)

14. **Out of scope, don't build toward it "for later":** image upload/generation (Strava's API has no media endpoint), HealthKit ingest, reading any data back from Strava, multi-user support, a native iOS app or Share Extension. → [Purpose §1](planning/01-purpose-and-prerequisites.md)

---

← [Index](PLANNING.md)
