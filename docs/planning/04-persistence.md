---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 6. Persistence

Firestore, native mode. Two collections.

### `workouts/{dedupe_key}`

`dedupe_key` derivation, in order:

1. `strong:{slug}` when a share link is present.
2. `sha256:{first 32 hex characters}` of the UTF-8 string formed by `started_at`, then `|`, then each `${exercise.name}:${exercise.sets.length}` segment joined with `|`, otherwise.

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

Rolling per-exercise state for deterministic description context ([§8](06-activity-text.md)). Written after a successful post.

```
{ exercise_name, best_e1rm, best_top_set: {weight, unit, reps},
  last_performed: timestamp, recent: [ {date, top_set, volume} ]  # last 10
}
```

Exercise-name → Strava taxonomy mapping is **not required** for the primary path ([§7.4](05-strava-integration.md#74-creating-the-activity)). Defer it to Phase 2.

### Data model for activity text

`app/models.ts` defines these TypeScript types and derives them from the two collections above. The deterministic formatter in [§8](06-activity-text.md) consumes them. They are not persisted directly — build them per request from `parsed` (for `WorkoutSummary`) and `history/{exercise_name}` documents (for `HistoryContext`). Persisted Firestore fields retain the snake_case names shown here.

```typescript
export type TopSet = {
  weight: number;
  unit: "lb" | "kg";
  reps: number;
};

export interface WorkoutSummary {
  workout_name: string;       // title_line, §3
  started_at: string;         // naive local ISO-8601, no offset
  total_volume: number;       // working sets only
  total_reps: number;
  total_sets: number;
  exercises: ExerciseSummary[];
}

export interface ExerciseSummary {
  name: string;               // base name, equipment stripped (§3 rule 7)
  equipment: string | null;
  top_set: TopSet | null;
  total_volume: number;
  total_reps: number;
  sets: WorkoutSet[];         // parser output, working + warmup
}

export interface HistoryContext {
  per_exercise: Record<string, ExerciseHistory>;
  pr_flags: Record<string, boolean>; // code-computed, decision 0005
}

export interface ExerciseHistory {
  best_e1rm: number | null;
  best_top_set: TopSet | null;
  days_since_last: number | null; // null when never performed before
  volume_trend: "up" | "down" | "flat" | null; // null when <2 data points
}
```

`HistoryContext` is empty (`per_exercise` and `pr_flags` both `{}`) for an exercise never seen before — [§8](06-activity-text.md)'s "omit comparative claims" rule applies per-exercise, not to the whole call.

---

← [Index](../PLANNING.md) · Previous: [Ingest API](03-ingest-api.md) · Next: [Strava integration](05-strava-integration.md)

