---
status: authoritative
last-updated: 2026-09-10
---

← [Index](../PLANNING.md)

## 6. Persistence

Firestore, native mode. Two collections.

### `workouts/{dedupe_key}`

`dedupe_key` derivation, in order:

1. `strong:{slug}` when a share link is present.
2. `sha256:{hex[:32]}` of `started_at.isoformat() + "|" + "|".join(f"{name}:{len(sets)}")` otherwise.

**[U] The slug's stability across repeated shares of the same workout is unverified.** If Strong mints a fresh slug per share, rule 1 silently stops deduplicating. Mitigation: on ingest, also compute the content hash and store it as `content_hash`; before creating an activity, query for an existing document with the same `content_hash` and treat a hit as a duplicate. This makes correctness independent of the [U] claim.

```
{
  dedupe_key:    string
  content_hash:  string
  raw_text:      string          # verbatim, always — enables re-parsing after parser fixes
  parsed:        map             # parser output
  started_at:    timestamp
  elapsed_s:     int
  received_at:   timestamp
  title:         string | null
  description:   string | null
  strava:        { activity_id, upload_id, url, method } | null
  status:        "received" | "posted" | "failed"
  error:         string | null
  attempts:      int
}
```

**Always store `raw_text`**, including when parsing fails. When the parser learns a new set format, history can be re-parsed.

### `history/{exercise_name}`

Rolling per-exercise state for description context ([§8](06-llm-generation.md)). Written after a successful post.

```
{ exercise_name, best_e1rm, best_top_set: {weight, unit, reps},
  last_performed: timestamp, recent: [ {date, top_set, volume} ]  # last 10
}
```

Exercise-name → Strava taxonomy mapping is **not required** for the primary path ([§7.4](05-strava-integration.md#74-creating-the-activity)). Defer it to Phase 2.

---

← [Index](../PLANNING.md) · Previous: [Ingest API](03-ingest-api.md) · Next: [Strava integration](05-strava-integration.md)

