/**
 * Firestore read/write for the `workouts` and `history` collections (§6).
 *
 * This module owns the `workouts/{dedupe_key}` document shape, the two
 * idempotency lookups §6 requires before any Strava activity is created, and
 * the `history/{exercise_name}` documents written after a successful post:
 *
 *   1. `workouts/{dedupe_key}` by document id, then
 *   2. a query for an existing document with the same `content_hash`.
 *
 * `history` is written only from `recordResult` after the Strava post
 * succeeds, so a failed post never advances a personal best (§6). It never
 * logs `raw_text` (constraint 7). Firestore errors propagate untouched so the
 * ingest route can map them to a 500 (constraint 11 / error handling §11).
 */

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

/** §6 `strava` field: the creation path that posted the activity, or null. */
export interface StravaRecord {
  activity_id: string | null;
  upload_id: string | null;
  url: string | null;
  method: string | null;
}

/** A document read back from `workouts/{dedupe_key}`. */
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

/** Everything the store needs for the §6 initial write. */
export interface ReceivedWorkout {
  dedupe_key: string;
  content_hash: string;
  raw_text: string;
  parsed: Workout | null;
  started_at: Timestamp | null;
  elapsed_s: number | null;
  received_at: Timestamp;
}

/** Terminal outcome written after the Strava call (success or failure). */
export interface WorkoutResult {
  status: Exclude<WorkoutStatus, "received">;
  strava: StravaRecord | null;
  error: string | null;
}

/** One entry in {@link StoredExerciseHistory.recent}; the last 10 only (§6). */
export interface HistoryRecentEntry {
  date: Timestamp;
  top_set: TopSet | null;
  volume: number;
}

/** A `history/{exercise_name}` document read back from Firestore (§6). */
export interface StoredExerciseHistory {
  exercise_name: string;
  best_e1rm: number | null;
  best_top_set: TopSet | null;
  last_performed: Timestamp;
  recent: HistoryRecentEntry[];
}

// --- Firestore seam ---------------------------------------------------------

/** Snapshot of one `workouts` document. */
export interface WorkoutDocumentSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

/** Snapshot of a `workouts` document that matched a query (always exists). */
export interface WorkoutQueryDocumentSnapshot {
  data(): Record<string, unknown>;
}

export interface WorkoutQuerySnapshot {
  readonly empty: boolean;
  readonly docs: WorkoutQueryDocumentSnapshot[];
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

/** Minimal Firestore surface used by {@link WorkoutStore}. */
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
   * The dual idempotency lookup of §6: `workouts/{dedupe_key}` first, then a
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
    return first === undefined ? null : toStoredWorkout(first.data());
  }

  /**
   * Initial write of the full §6 document with `status="received"`. `parsed`,
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
   * incremented `attempts`. A read-modify-write is enough here — §12 forbids a
   * background retry queue, and the §6 idempotency record is already durable
   * before the Strava call, so no two flows race on the same document.
   */
  async recordResult(
    dedupeKey: string,
    result: WorkoutResult,
  ): Promise<void> {
    const reference = this.#workouts.doc(dedupeKey);
    const snapshot = await reference.get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    const currentAttempts = data?.["attempts"];
    const attempts =
      typeof currentAttempts === "number" ? currentAttempts + 1 : 1;

    await reference.update({
      status: result.status,
      strava: result.strava,
      error: result.error,
      attempts,
    });

    // §6: history is written only after a successful post. A failed post must
    // not advance a personal best, so anything but `posted` skips this.
    if (result.status !== "posted") {
      return;
    }

    const parsed = (data?.["parsed"] ?? null) as Workout | null;
    const startedAt = (data?.["started_at"] ?? null) as Timestamp | null;
    if (parsed === null || startedAt === null) {
      return;
    }

    for (const exercise of summarizeWorkout(parsed).exercises) {
      await this.#recordExerciseHistory(exercise, startedAt);
    }
  }

  /**
   * Read one `history/{exercise_name}` document for the activity-text context
   * (§6). Returns null for an exercise that has never been posted before.
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
   * Read the §6 activity-text context for a workout before the post. Each
   * exercise's history document is read by base name; a missing document
   * leaves the exercise out of the context (§6: the omit-comparative-claims
   * rule applies per exercise). The caller supplies the workout's start
   * timestamp so `days_since_last` is measured against this workout rather
   * than against server receipt time.
   */
  async getHistoryContext(
    summary: WorkoutSummary,
    startedAt: Timestamp,
  ): Promise<HistoryContext> {
    const names = [...new Set(summary.exercises.map((exercise) => exercise.name))];
    const entries = await Promise.all(
      names.map(async (name) => [name, await this.getExerciseHistory(name)] as const),
    );
    return buildHistoryContext(summary, new Map(entries), startedAt);
  }

  /**
   * Rolling update of one exercise's history document: raise `best_e1rm` and
   * `best_top_set` against the stored values, bump `last_performed`, and keep
   * `recent` capped at its last {@link HISTORY_RECENT_LIMIT} entries (§6).
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

/** §6: `recent` is a rolling window of the last 10 entries. */
const HISTORY_RECENT_LIMIT = 10;

/**
 * Epley estimated one-rep max: `weight × (1 + reps / 30)`. The glossary
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

/** Highest {@link estimateE1rm} across an exercise's working sets. */
function bestE1rm(sets: WorkoutSet[]): number | null {
  let best: number | null = null;
  for (const set of sets) {
    if (set.is_warmup || set.weight === null || set.reps === null) {
      continue;
    }
    const estimate = estimateE1rm(set.weight, set.reps);
    if (estimate !== null && (best === null || estimate > best)) {
      best = estimate;
    }
  }
  return best;
}

/** Lexicographic `(weight, reps)` max for §6 `best_top_set` (§3 top-set rule). */
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
 * §6 `volume_trend`: null under two data points, otherwise the direction
 * from the oldest to the newest volume in the rolling `recent` window.
 */
function volumeTrend(
  recent: HistoryRecentEntry[],
): ExerciseHistory["volume_trend"] {
  if (recent.length < 2) {
    return null;
  }
  const first = recent[0]?.volume ?? 0;
  const last = recent[recent.length - 1]?.volume ?? 0;
  if (last > first) {
    return "up";
  }
  if (last < first) {
    return "down";
  }
  return "flat";
}

/**
 * Assemble the §6 `HistoryContext` for one workout from stored `history`
 * documents. Pure and synchronous: the caller reads the documents and passes
 * them keyed by base exercise name (`null` for an unseen exercise).
 *
 * - Unseen exercises are left out of both maps (§6: the omit-comparative-
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

/** Adapt a real `@google-cloud/firestore` client to the {@link WorkoutFirestore} seam. */
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
    dedupe_key: asString(data["dedupe_key"]),
    content_hash: asString(data["content_hash"]),
    raw_text: asString(data["raw_text"]),
    parsed: (data["parsed"] ?? null) as Workout | null,
    started_at: (data["started_at"] ?? null) as Timestamp | null,
    elapsed_s: asNullableNumber(data["elapsed_s"]),
    received_at: data["received_at"] as Timestamp,
    title: asNullableString(data["title"]),
    description: asNullableString(data["description"]),
    strava: (data["strava"] ?? null) as StravaRecord | null,
    status: asStatus(data["status"]),
    error: asNullableString(data["error"]),
    attempts: asNumber(data["attempts"]),
  };
}

function toStoredExerciseHistory(
  data: Record<string, unknown>,
): StoredExerciseHistory {
  return {
    exercise_name: asString(data["exercise_name"]),
    best_e1rm: asNullableNumber(data["best_e1rm"]),
    best_top_set: asNullableTopSet(data["best_top_set"]),
    last_performed: data["last_performed"] as Timestamp,
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
    return [];
  }
  const entries: HistoryRecentEntry[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const date = record["date"];
    if (!(date instanceof Timestamp)) {
      continue;
    }
    entries.push({
      date,
      top_set: asNullableTopSet(record["top_set"]),
      volume: asNumber(record["volume"]),
    });
  }
  return entries;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asStatus(value: unknown): WorkoutStatus {
  return value === "posted" || value === "failed" ? value : "received";
}
