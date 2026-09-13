---
status: authoritative
last-updated: 2026-09-13
---

← [Index](PLANNING.md)

# Glossary

Domain terms used across the spec, each pointing at its defining section. Read the linked section for the authoritative definition; this file is a pointer, not a replacement.

- **dedupe_key** — the Firestore document id for a workout: `strong:{slug}` when a share link is present, otherwise `sha256:{first 32 hex characters}` of `started_at` + exercise names/set counts. → [§6](planning/04-persistence.md)
- **content_hash** — a hash of `started_at` + exercise names and set counts, stored alongside `dedupe_key` so dedup stays correct even if the share slug is unstable. → [§6](planning/04-persistence.md), [ADR 0003](decisions/0003-content-hash-dedupe-guard.md)
- **raw_text** — the verbatim Strong share text, always persisted so history can be re-parsed after parser fixes. → [§3](planning/02-input-contract.md), [§6](planning/04-persistence.md)
- **working set** — a non-warmup set; the only sets counted in volume, rep, and set totals. → [§3](planning/02-input-contract.md)
- **warmup set** — a set whose index begins with `W`; retained in the parsed structure but excluded from all totals. → [§3](planning/02-input-contract.md)
- **top_set** — an exercise's working set with the greatest `(weight, reps)` lexicographically. → [§3](planning/02-input-contract.md)
- **volume** — per set, `weight × reps` (0 when either is absent); `total_volume` sums working sets only. → [§3](planning/02-input-contract.md)
- **unparsed** — the retention kind for a set payload the parser doesn't recognize; kept with its raw text, never dropped. → [§3](planning/02-input-contract.md)
- **history** — the Firestore `history/{exercise_name}` collection holding per-exercise rolling state for description context. → [§6](planning/04-persistence.md)
- **e1rm** — estimated one-rep max, a derived per-exercise strength benchmark stored in `history`. The exact formula is not specified in the spec; define it when implementing. → [§6](planning/04-persistence.md)
- **PR flags** — code-computed booleans (e.g. `is_weight_pr`) compared against `history` and passed to the model as explicit booleans; never model-computed. → [§6](planning/04-persistence.md), [§8](planning/06-llm-generation.md), [ADR 0005](decisions/0005-pr-detection-in-code.md)
- **[V] / [U]** — verification tags on Strava API claims: verified against Strava's docs vs. unverified/contradicted (probe at runtime; don't build a required path on it). → [PLANNING.md](PLANNING.md)
- **path_token / X-Ingest-Key** — the two static auth secrets checked on ingest; a failed check returns 404 with an empty body. → [§5](planning/03-ingest-api.md)

---

← [Index](PLANNING.md)
