import { Firestore, type Timestamp } from "@google-cloud/firestore";

import type { HistoryContext, WorkoutSummary } from "../models.js";
import {
  firestoreWorkouts,
  WorkoutStore,
  type ReceivedWorkout,
  type StoredWorkout,
  type WorkoutResult,
} from "../store.js";

export interface WorkoutStoreLike {
  findExisting(
    dedupeKey: string,
    contentHash: string,
  ): Promise<StoredWorkout | null>;
  recordReceived(workout: ReceivedWorkout): Promise<void>;
  recordResult(dedupeKey: string, result: WorkoutResult): Promise<void>;
  getHistoryContext(
    summary: WorkoutSummary,
    startedAt: Timestamp,
  ): Promise<HistoryContext>;
}

export function defaultStore(): WorkoutStore {
  return new WorkoutStore(firestoreWorkouts(new Firestore()));
}

