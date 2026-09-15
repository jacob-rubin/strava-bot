/**
 * Firestore read/write for the `workouts` collection (§6).
 *
 * This module owns the `workouts/{dedupe_key}` document shape and the two
 * idempotency lookups §6 requires before any Strava activity is created:
 *
 *   1. `workouts/{dedupe_key}` by document id, then
 *   2. a query for an existing document with the same `content_hash`.
 *
 * It is deliberately a thin persistence seam: it does not compute
 * `dedupe_key`, `content_hash`, `started_at`, or `elapsed_s` (the parser and
 * the ingest route own those), and it never logs `raw_text` (constraint 7).
 * Firestore errors propagate untouched so the ingest route can map them to a
 * 500 (constraint 11 / error handling §11).
 */

import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "@google-cloud/firestore";

import type { Workout } from "./models.js";

const WORKOUTS_COLLECTION = "workouts";

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

  constructor(db: WorkoutFirestore) {
    this.#workouts = db.collection(WORKOUTS_COLLECTION);
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
    const currentAttempts = snapshot.exists
      ? snapshot.data()?.["attempts"]
      : undefined;
    const attempts =
      typeof currentAttempts === "number" ? currentAttempts + 1 : 1;

    await reference.update({
      status: result.status,
      strava: result.strava,
      error: result.error,
      attempts,
    });
  }
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
