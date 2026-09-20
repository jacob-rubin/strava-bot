/** Weight units Strong emits; never normalized before docs/reference/strava.md. */
export type WeightUnit = "lb" | "kg";

/** Distance units Strong emits (docs/reference/input-contract.md). */
export type DistanceUnit = "mi" | "km" | "m" | "ft";

export type SetKind =
  | "weight_reps"
  | "assisted_reps"
  | "reps"
  | "time"
  | "distance"
  | "distance_time"
  | "unparsed";

interface WorkoutSetBase {
  /** Raw index token from `Set <index>:` — `"1"`, `"W"`, or any other token. */
  index: string;
  /** Input contract rule 8: warmups remain parsed but are excluded from totals. */
  is_warmup: boolean;
  /** Derived value: `weight × reps`, or `0` when either is absent; never normalize. */
  volume: number;
}

export interface WeightRepsSet extends WorkoutSetBase {
  kind: "weight_reps";
  weight: number;
  unit: WeightUnit;
  reps: number;
  duration_s: null;
  distance: null;
  distance_unit: null;
}

export interface AssistedRepsSet extends WorkoutSetBase {
  kind: "assisted_reps";
  /** Input contract: preserve the signed load; negative means machine assistance. */
  weight: number;
  unit: WeightUnit;
  reps: number;
  duration_s: null;
  distance: null;
  distance_unit: null;
}

export interface RepsSet extends WorkoutSetBase {
  kind: "reps";
  weight: null;
  unit: null;
  reps: number;
  duration_s: null;
  distance: null;
  distance_unit: null;
}

export interface TimeSet extends WorkoutSetBase {
  kind: "time";
  weight: null;
  unit: null;
  reps: null;
  duration_s: number;
  distance: null;
  distance_unit: null;
}

export interface DistanceSet extends WorkoutSetBase {
  kind: "distance";
  weight: null;
  unit: null;
  reps: null;
  duration_s: null;
  distance: number;
  distance_unit: DistanceUnit;
}

export interface DistanceTimeSet extends WorkoutSetBase {
  kind: "distance_time";
  weight: null;
  unit: null;
  reps: null;
  duration_s: number;
  distance: number;
  distance_unit: DistanceUnit;
}

/** Constraint 5 and input contract rule 9: retain unrecognized payloads; never drop a line. */
export interface UnparsedSet extends WorkoutSetBase {
  kind: "unparsed";
  raw: string;
  weight: null;
  unit: null;
  reps: null;
  duration_s: null;
  distance: null;
  distance_unit: null;
}

export type WorkoutSet =
  | WeightRepsSet
  | AssistedRepsSet
  | RepsSet
  | TimeSet
  | DistanceSet
  | DistanceTimeSet
  | UnparsedSet;

export interface Exercise {
  /** Input contract rule 7: base name with trailing equipment parenthetical stripped. */
  name: string;
  /** Input contract rule 7: absent equipment parentheses are `null`. */
  equipment: string | null;
  sets: WorkoutSet[];
}

/** Persisted verbatim under `workouts/{dedupe_key}.parsed`. */
export interface Workout {
  /** Input contract `title_line`. */
  workout_name: string;
  /** Input contract: naive local ISO-8601, with no offset. */
  started_at: string;
  exercises: Exercise[];
  /** Input contract rule 5: Strong share slug, or `null` when absent. */
  share_slug: string | null;
  /** Input contract rule 3: non-fatal parse notes. */
  warnings: string[];
}

export type TopSet = {
  weight: number;
  unit: "lb" | "kg";
  reps: number;
};

export interface WorkoutSummary {
  workout_name: string; // title_line
  started_at: string; // naive local ISO-8601, no offset
  total_volume: number; // working sets only
  total_reps: number;
  total_sets: number;
  exercises: ExerciseSummary[];
}

export interface ExerciseSummary {
  name: string; // base name, equipment stripped (rule 7)
  equipment: string | null;
  top_set: TopSet | null;
  total_volume: number;
  total_reps: number;
  sets: WorkoutSet[]; // parser output, working + warmup
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

export type ActivityText = { title: string; description: string };
