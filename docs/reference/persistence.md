# Persistence

Firestore, native mode, two collections, implemented in [`app/store.ts`](../../app/store.ts). Persisted field names are snake_case exactly as written here.

## Terms

- **dedupe_key** — the `workouts` document id: `strong:{slug}` when a share link is present, otherwise `sha256:{first 32 hex characters}`.
- **content_hash** — a hash of the same content, stored alongside `dedupe_key` so dedupe stays correct even if the share slug is unstable.
- **raw_text** — the verbatim Strong share text, always persisted so history can be re-parsed after parser fixes.
- **history** — the `history/{exercise_name}` collection holding rolling per-exercise state for description context.
- **e1rm** — estimated one-rep max, computed with the Epley formula `weight × (1 + reps / 30)`; a single-rep set is already a one-rep max and is returned unchanged.
- **PR flags** — code-computed booleans, keyed `{exercise}:weight`, compared against `history` and consumed by the formatter ([ADR 0005](../decisions/0005-pr-detection-in-code.md)).

## `workouts/{dedupe_key}`

`dedupe_key` derivation, in order:

1. `strong:{slug}` when a share link is present.
2. `sha256:{first 32 hex characters}` of the UTF-8 string formed by `started_at`, then `|`, then each `${exercise.name}:${exercise.sets.length}` segment joined with `|`.

Whether Strong's slug is stable across repeated shares of the same workout is unverified, and rule 1 would silently stop deduplicating if it is not. The same content hash is therefore stored as `content_hash`, and the idempotency lookup falls back to a `content_hash` equality query when the document id misses — which makes correctness independent of the slug ([ADR 0003](../decisions/0003-content-hash-dedupe-guard.md)).

```
{
  dedupe_key:    string
  content_hash:  string
  raw_text:      string          # verbatim, always — enables re-parsing after parser fixes
  parsed:        map | null      # parser output; null when parsing failed
  started_at:    timestamp | null
  elapsed_s:     int | null
  received_at:   timestamp
  title:         string | null
  description:   string | null
  strava:        { activity_id, upload_id, url, method } | null
  status:        "received" | "posted" | "failed"
  error:         string | null
  attempts:      int
}
```

**`raw_text` is always stored**, including when parsing fails ([Constraint 6](../CONSTRAINTS.md)). When the parser learns a new set format, stored history can be re-parsed ([operations](../operations.md#re-parsing-stored-workouts)).

The terminal update after the Strava call writes `status`, `strava`, and `error`, and increments `attempts`. A read-modify-write is sufficient: there is no background retry queue, and the idempotency record is already durable before the Strava call, so no two flows race on one document. A document missing its numeric `attempts` field is treated as a corrupt idempotency record and raises rather than being silently repaired.

## `history/{exercise_name}`

Rolling per-exercise state for deterministic description context, keyed by base exercise name and written **only after a successful post** — a failed post must not advance a personal best.

```
{ exercise_name, best_e1rm, best_top_set: {weight, unit, reps},
  last_performed: timestamp, recent: [ {date, top_set, volume} ]  # last 10
}
```

Each update raises `best_e1rm` and `best_top_set` against the stored values, bumps `last_performed`, and appends to `recent`, which is capped at its last 10 entries. Only working sets with both a positive weight and at least one rep contribute an e1rm estimate.

Exercise-name to Strava-taxonomy mapping is deliberately absent; the structured-upload path sends null categories rather than guessing ([strava](strava.md#structured-uploads)).

## Data model for activity text

These types live in [`app/models.ts`](../../app/models.ts) and are built per request — `WorkoutSummary` from `parsed`, `HistoryContext` from the `history` documents — rather than persisted directly.

```typescript
export type TopSet = {
  weight: number;
  unit: "lb" | "kg";
  reps: number;
};

export interface WorkoutSummary {
  workout_name: string;       // line 1 of the share text
  started_at: string;         // naive local ISO-8601, no offset
  total_volume: number;       // working sets only
  total_reps: number;
  total_sets: number;
  exercises: ExerciseSummary[];
}

export interface ExerciseSummary {
  name: string;               // base name, equipment stripped
  equipment: string | null;
  top_set: TopSet | null;
  total_volume: number;
  total_reps: number;
  sets: WorkoutSet[];         // parser output, working + warmup
}

export interface HistoryContext {
  per_exercise: Record<string, ExerciseHistory>;
  pr_flags: Record<string, boolean>; // code-computed, ADR 0005
}

export interface ExerciseHistory {
  best_e1rm: number | null;
  best_top_set: TopSet | null;
  days_since_last: number | null;              // null when never performed before
  volume_trend: "up" | "down" | "flat" | null; // null under two data points
}
```

An exercise never posted before is left out of both maps, so the "omit comparative claims" rule of the [formatter](activity-text.md) applies per exercise rather than to the whole call. `days_since_last` is measured from `last_performed` to *this workout's* start, in whole days, clamped at zero. `volume_trend` compares the oldest and newest volumes in the rolling `recent` window. A weight PR flag is set when this workout's best e1rm for an exercise exceeds the stored `best_e1rm`.

---

← [Docs index](../README.md) · [Input contract](input-contract.md) · [Activity text](activity-text.md)

