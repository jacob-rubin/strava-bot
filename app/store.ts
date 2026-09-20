import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "@google-cloud/firestore";

import type {
  ExerciseHistory,
  ExerciseSummary,
  HistoryContext,
  TopSet,
  Workout,
  WorkoutSet,
  WorkoutSummary,
} from "./models.js";
import { summarizeWorkout } from "./parser.js";

const WORKOUTS_COLLECTION = "workouts";
const HISTORY_COLLECTION = "history";

export type WorkoutStatus = "received" | "posted" | "failed";

export interface StravaRecord {
  readonly activity_id: string | null;
  readonly upload_id: string | null;
  readonly url: string | null;
  readonly method: string | null;
}

export interface StoredWorkout {
  dedupe_key: string;
  content_hash: string;
  raw_text: string;
  parsed: Workout | null;
  started_at: Timestamp | null;
  elapsed_s: number | null;
  received_at: Timestamp;
  title: string | null;
  description: string | null;
  strava: StravaRecord | null;
  status: WorkoutStatus;
  error: string | null;
  attempts: number;
}

export interface ReceivedWorkout {
  readonly dedupe_key: string;
  readonly content_hash: string;
  readonly raw_text: string;
  readonly parsed: Workout | null;
  readonly started_at: Timestamp | null;
  readonly elapsed_s: number | null;
  readonly received_at: Timestamp;
}

export interface WorkoutResult {
  readonly status: Exclude<WorkoutStatus, "received">;
  readonly strava: StravaRecord | null;
  readonly error: string | null;
}

/** One entry in {@link StoredExerciseHistory.recent}; the last 10 only. */
export interface HistoryRecentEntry {
  readonly date: Timestamp;
  readonly top_set: TopSet | null;
  readonly volume: number;
}

/** A `history/{exercise_name}` document read back from Firestore. */
export interface StoredExerciseHistory {
  readonly exercise_name: string;
  readonly best_e1rm: number | null;
  readonly best_top_set: TopSet | null;
  readonly last_performed: Timestamp;
  readonly recent: readonly HistoryRecentEntry[];
}

// --- Firestore seam ---------------------------------------------------------

export interface WorkoutDocumentSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface WorkoutQueryDocumentSnapshot {
  data(): Record<string, unknown>;
}

export interface WorkoutQuerySnapshot {
  readonly empty: boolean;
  readonly docs: readonly WorkoutQueryDocumentSnapshot[];
}

export interface WorkoutDocumentReference {
  get(): Promise<WorkoutDocumentSnapshot>;
  set(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface WorkoutQuery {
  limit(n: number): WorkoutQuery;
  get(): Promise<WorkoutQuerySnapshot>;
}

export interface WorkoutCollectionReference {
  doc(id: string): WorkoutDocumentReference;
  where(fieldPath: string, opStr: "==", value: string): WorkoutQuery;
}

export interface WorkoutFirestore {
  collection(collectionPath: string): WorkoutCollectionReference;
}

// --- Store ------------------------------------------------------------------

export class WorkoutStore {
  readonly #workouts: WorkoutCollectionReference;
  readonly #history: WorkoutCollectionReference;

  constructor(db: WorkoutFirestore) {
    this.#workouts = db.collection(WORKOUTS_COLLECTION);
    this.#history = db.collection(HISTORY_COLLECTION);
  }

  /**
   * The dual idempotency lookup of docs/reference/persistence.md:
   * `workouts/{dedupe_key}` first, then a
   * `content_hash` equality query on a miss.
   */
  async findExisting(
    dedupeKey: string,
    contentHash: string,
  ): Promise<StoredWorkout | null> {
    const snapshot = await this.#workouts.doc(dedupeKey).get();
    if (snapshot.exists) {
      return toStoredWorkout(snapshot.data() ?? {});
    }

    const results = await this.#workouts
      .where("content_hash", "==", contentHash)
      .limit(1)
      .get();
    if (results.empty) {
      return null;
    }

    const first = results.docs[0];
    if (first === undefined) {
      throw new Error(
        "content_hash query reported non-empty but returned no documents",
      );
    }
    return toStoredWorkout(first.data());
  }

  /**
   * Initial write of the full workout document with `status="received"`. `parsed`,
   * `started_at`, and `elapsed_s` are null when parsing failed — `raw_text` is
   * still persisted verbatim (constraint 6).
   */
  async recordReceived(workout: ReceivedWorkout): Promise<void> {
    await this.#workouts.doc(workout.dedupe_key).set({
      dedupe_key: workout.dedupe_key,
      content_hash: workout.content_hash,
      raw_text: workout.raw_text,
      parsed: workout.parsed,
      started_at: workout.started_at,
      elapsed_s: workout.elapsed_s,
      received_at: workout.received_at,
      title: null,
      description: null,
      strava: null,
      status: "received",
      error: null,
      attempts: 0,
    });
  }

  /**
   * Terminal update after the Strava call: `status`, `strava`, `error`, and an
   * incremented `attempts`. A read-modify-write is enough here — constraint 12 forbids a
   * background retry queue, and the idempotency record is already durable
   * before the Strava call, so no two flows race on the same document.
   */
  async recordResult(dedupeKey: string, result: WorkoutResult): Promise<void> {
    const reference = this.#workouts.doc(dedupeKey);
    const snapshot = await reference.get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    const currentAttempts = data?.["attempts"];
    if (typeof currentAttempts !== "number") {
      throw new Error(
        `workouts document "${dedupeKey}" is missing the required numeric field "attempts"; the idempotency record is corrupt or absent`,
      );
    }
    const attempts = currentAttempts + 1;

    await reference.update({
      status: result.status,
      strava: result.strava,
      error: result.error,
      attempts,
    });

    // History is written only after a successful post. A failed post must
    // not advance a personal best, so anything but `posted` skips this.
    if (result.status !== "posted") {
      return;
    }

    const parsed = (data?.["parsed"] ?? null) as Workout | null;
    const startedAt = asNullableTimestamp(data?.["started_at"], "started_at");
    if (parsed === null || startedAt === null) {
      return;
    }

    for (const exercise of summarizeWorkout(parsed).exercises) {
      await this.#recordExerciseHistory(exercise, startedAt);
    }
  }

  /**
   * Read one `history/{exercise_name}` document for the activity-text context
   * Returns null for an exercise that has never been posted before.
   */
  async getExerciseHistory(
    exerciseName: string,
  ): Promise<StoredExerciseHistory | null> {
    const snapshot = await this.#history.doc(exerciseName).get();
    if (!snapshot.exists) {
      return null;
    }
    return toStoredExerciseHistory(snapshot.data() ?? {});
  }

  /**
   * Read the activity-text context for a workout before the post. Each
   * exercise's history document is read by base name; a missing document
   * leaves the exercise out of the context (the omit-comparative-claims
   * rule applies per exercise). The caller supplies the workout's start
   * timestamp so `days_since_last` is measured against this workout rather
   * than against server receipt time.
   */
  async getHistoryContext(
    summary: WorkoutSummary,
    startedAt: Timestamp,
  ): Promise<HistoryContext> {
    const names = [
      ...new Set(summary.exercises.map((exercise) => exercise.name)),
    ];
    const entries = await Promise.all(
      names.map(
        async (name) => [name, await this.getExerciseHistory(name)] as const,
      ),
    );
    return buildHistoryContext(summary, new Map(entries), startedAt);
  }

  /**
   * Rolling update of one exercise's history document: raise `best_e1rm` and
   * `best_top_set` against the stored values, bump `last_performed`, and keep
   * `recent` capped at its last {@link HISTORY_RECENT_LIMIT} entries.
   */
  async #recordExerciseHistory(
    exercise: ExerciseSummary,
    performedAt: Timestamp,
  ): Promise<void> {
    const reference = this.#history.doc(exercise.name);
    const snapshot = await reference.get();
    const existing = snapshot.exists
      ? toStoredExerciseHistory(snapshot.data() ?? {})
      : null;

    const currentBestE1rm = bestE1rm(exercise.sets);
    const bestE1rmValue = maxNullable(
      existing?.best_e1rm ?? null,
      currentBestE1rm,
    );
    const bestTopSet = betterTopSet(
      existing?.best_top_set ?? null,
      exercise.top_set,
    );
    const recent = [
      ...(existing?.recent ?? []),
      {
        date: performedAt,
        top_set: exercise.top_set,
        volume: exercise.total_volume,
      },
    ].slice(-HISTORY_RECENT_LIMIT);

    await reference.set({
      exercise_name: exercise.name,
      best_e1rm: bestE1rmValue,
      best_top_set: bestTopSet,
      last_performed: performedAt,
      recent,
    });
  }
}

// --- History helpers ---------------------------------------------------------

/** Persistence: `recent` is a rolling window of the last 10 entries. */
const HISTORY_RECENT_LIMIT = 10;

/**
 * Epley estimated one-rep max: `weight × (1 + reps / 30)`. The spec
 * leaves the formula to the implementer; Epley is the standard, deterministic
 * choice. A one-rep set is already a one-rep max, so it is returned unchanged
 * rather than inflated. Non-positive loads (machine assistance) and reps below
 * 1 have no meaningful estimate.
 */
export function estimateE1rm(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0) {
    return null;
  }
  if (!Number.isFinite(reps) || reps < 1) {
    return null;
  }
  if (reps === 1) {
    return weight;
  }
  return weight * (1 + reps / 30);
}

function bestE1rm(sets: readonly WorkoutSet[]): number | null {
  return sets.reduce<number | null>((best, set) => {
    if (set.is_warmup || set.weight === null || set.reps === null) {
      return best;
    }
    const estimate = estimateE1rm(set.weight, set.reps);
    if (estimate !== null && (best === null || estimate > best)) {
      return estimate;
    }
    return best;
  }, null);
}

/** Lexicographic `(weight, reps)` max for `best_top_set` (input-contract top set). */
function betterTopSet(a: TopSet | null, b: TopSet | null): TopSet | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  if (b.weight !== a.weight) {
    return b.weight > a.weight ? b : a;
  }
  return b.reps > a.reps ? b : a;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a > b ? a : b;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from a stored `last_performed` timestamp to this workout's
 * start. Clamped at zero for a workout and history entry that share a day
 * (or for a clock skew that would otherwise report a negative gap).
 */
function daysSince(lastPerformed: Timestamp, startedAt: Timestamp): number {
  const differenceMs = startedAt.toMillis() - lastPerformed.toMillis();
  return Math.max(0, Math.floor(differenceMs / MS_PER_DAY));
}

/**
 * `volume_trend`: null under two data points, otherwise the direction
 * from the oldest to the newest volume in the rolling `recent` window.
 */
function volumeTrend(
  recent: readonly HistoryRecentEntry[],
): ExerciseHistory["volume_trend"] {
  if (recent.length < 2) {
    return null;
  }
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(
      "volume trend needs the two entries the length check guarantees",
    );
  }
  if (last.volume > first.volume) {
    return "up";
  }
  if (last.volume < first.volume) {
    return "down";
  }
  return "flat";
}

/**
 * Assemble the `HistoryContext` for one workout from stored `history`
 * documents. Pure and synchronous: the caller reads the documents and passes
 * them keyed by base exercise name (`null` for an unseen exercise).
 *
 * - Unseen exercises are left out of both maps (the omit-comparative-
 *   claims rule applies per exercise).
 * - `days_since_last` is null only when the exercise was never performed
 *   before; once a history document exists it is always a whole-day count.
 * - PR flags are computed here (ADR 0005); the formatter only consumes the
 *   explicit booleans and never infers a PR itself.
 */
export function buildHistoryContext(
  summary: WorkoutSummary,
  histories: ReadonlyMap<string, StoredExerciseHistory | null>,
  startedAt: Timestamp,
): HistoryContext {
  const perExercise: Record<string, ExerciseHistory> = {};
  const prFlags: Record<string, boolean> = {};

  for (const exercise of summary.exercises) {
    const stored = histories.get(exercise.name);
    if (stored === undefined || stored === null) {
      continue;
    }

    perExercise[exercise.name] = {
      best_e1rm: stored.best_e1rm,
      best_top_set: stored.best_top_set,
      days_since_last: daysSince(stored.last_performed, startedAt),
      volume_trend: volumeTrend(stored.recent),
    };

    const currentBest = bestE1rm(exercise.sets);
    const previousBest = stored.best_e1rm;
    if (
      currentBest !== null &&
      previousBest !== null &&
      currentBest > previousBest
    ) {
      prFlags[`${exercise.name}:weight`] = true;
    }
  }

  return { per_exercise: perExercise, pr_flags: prFlags };
}

// --- Real-client adapter -----------------------------------------------------

export function firestoreWorkouts(db: Firestore): WorkoutFirestore {
  return {
    collection: (collectionPath) => {
      const collectionRef = db.collection(collectionPath);
      return {
        doc: (id) => toDocumentReference(collectionRef.doc(id)),
        where: (fieldPath, opStr, value) =>
          toQuery(collectionRef.where(fieldPath, opStr, value)),
      };
    },
  };
}

function toDocumentReference(
  reference: DocumentReference,
): WorkoutDocumentReference {
  return {
    get: async () => {
      const snapshot = await reference.get();
      return toDocumentSnapshot(snapshot);
    },
    set: (data) => reference.set(data),
    update: (data) => reference.update(data),
  };
}

function toDocumentSnapshot(
  snapshot: DocumentSnapshot,
): WorkoutDocumentSnapshot {
  return {
    exists: snapshot.exists,
    data: () => snapshot.data() as Record<string, unknown> | undefined,
  };
}

function toQuery(query: Query): WorkoutQuery {
  return {
    limit: (n) => toQuery(query.limit(n)),
    get: async () => {
      const snapshot = await query.get();
      return {
        empty: snapshot.empty,
        docs: snapshot.docs.map((document) => ({
          data: () => document.data() as Record<string, unknown>,
        })),
      };
    },
  };
}

// --- Conversion helpers ------------------------------------------------------

function toStoredWorkout(data: Record<string, unknown>): StoredWorkout {
  return {
    dedupe_key: asString(data["dedupe_key"], "dedupe_key"),
    content_hash: asString(data["content_hash"], "content_hash"),
    raw_text: asString(data["raw_text"], "raw_text"),
    parsed: (data["parsed"] ?? null) as Workout | null,
    started_at: asNullableTimestamp(data["started_at"], "started_at"),
    elapsed_s: asNullableNumber(data["elapsed_s"]),
    received_at: asTimestamp(data["received_at"], "received_at"),
    title: asNullableString(data["title"]),
    description: asNullableString(data["description"]),
    strava: (data["strava"] ?? null) as StravaRecord | null,
    status: asStatus(data["status"]),
    error: asNullableString(data["error"]),
    attempts: asNumber(data["attempts"], "attempts"),
  };
}

function toStoredExerciseHistory(
  data: Record<string, unknown>,
): StoredExerciseHistory {
  return {
    exercise_name: asString(data["exercise_name"], "exercise_name"),
    best_e1rm: asNullableNumber(data["best_e1rm"]),
    best_top_set: asNullableTopSet(data["best_top_set"]),
    last_performed: asTimestamp(data["last_performed"], "last_performed"),
    recent: asRecentEntries(data["recent"]),
  };
}

function asNullableTopSet(value: unknown): TopSet | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const weight = record["weight"];
  const unit = record["unit"];
  const reps = record["reps"];
  if (
    typeof weight !== "number" ||
    (unit !== "lb" && unit !== "kg") ||
    typeof reps !== "number"
  ) {
    return null;
  }
  return { weight, unit, reps };
}

function asRecentEntries(value: unknown): HistoryRecentEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `stored history document is missing required array field "recent"`,
    );
  }
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(
        `stored history document has a malformed entry in "recent"`,
      );
    }
    const record = entry as Record<string, unknown>;
    return {
      date: asTimestamp(record["date"], "recent.date"),
      top_set: asNullableTopSet(record["top_set"]),
      volume: asNumber(record["volume"], "recent.volume"),
    };
  });
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `stored document is missing required string field "${field}"`,
    );
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(
      `stored document is missing required numeric field "${field}"`,
    );
  }
  return value;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asStatus(value: unknown): WorkoutStatus {
  if (value === "received" || value === "posted" || value === "failed") {
    return value;
  }
  throw new Error(
    `stored document has an unknown value in required field "status"`,
  );
}

function asTimestamp(value: unknown, field: string): Timestamp {
  if (!(value instanceof Timestamp)) {
    throw new Error(
      `stored document is missing required timestamp field "${field}"`,
    );
  }
  return value;
}

function asNullableTimestamp(value: unknown, field: string): Timestamp | null {
  if (value === null) {
    return null;
  }
  return asTimestamp(value, field);
}
