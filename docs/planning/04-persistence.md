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

### Data model for `generate()`

`app/models.py` derives these from the two collections above; they are the only inputs [§8](06-llm-generation.md) may see. Not persisted directly — built per-request from `parsed` (for `WorkoutSummary`) and `history/{exercise_name}` docs (for `HistoryContext`).

```
WorkoutSummary:
  workout_name:  string                # title_line, §3
  started_at:    datetime              # naive local
  total_volume:  number                # working sets only
  total_reps:    int
  total_sets:    int
  exercises:     [ ExerciseSummary ]

ExerciseSummary:
  name:          string                # base name, equipment stripped (§3 rule 7)
  equipment:     string | null
  top_set:       { weight, unit, reps } | null
  total_volume:  number
  total_reps:    int
  sets:          [ WorkoutSet ]        # parser output, working + warmup

HistoryContext:
  per_exercise:  { exercise_name: ExerciseHistory }
  pr_flags:      { exercise_name: bool }   # code-computed, §10 / decision 0005 — never model-computed

ExerciseHistory:
  best_e1rm:        number | null
  best_top_set:     { weight, unit, reps } | null
  days_since_last:  int | null          # null when never performed before
  volume_trend:     "up" | "down" | "flat" | null   # null when < 2 data points
```

`HistoryContext` is empty (`per_exercise` and `pr_flags` both `{}`) for an exercise never seen before — [§8](06-llm-generation.md)'s "omit comparative claims" rule applies per-exercise, not to the whole call.

---

← [Index](../PLANNING.md) · Previous: [Ingest API](03-ingest-api.md) · Next: [Strava integration](05-strava-integration.md)

