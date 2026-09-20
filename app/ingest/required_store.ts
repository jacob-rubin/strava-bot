import type { Timestamp } from "@google-cloud/firestore";

import type { HistoryContext, WorkoutSummary } from "../models.js";
import type { WorkoutStoreLike } from "../ports/workout_store_like.js";
import type {
  ReceivedWorkout,
  StoredWorkout,
  WorkoutResult,
} from "../store.js";
import { attempt, type Attempt } from "../util/attempt.js";
import { InternalError } from "./error.js";

export interface RequiredWorkoutStore {
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

export function requiredStore(store: WorkoutStoreLike): RequiredWorkoutStore {
  return {
    async findExisting(
      dedupeKey: string,
      contentHash: string,
    ): Promise<StoredWorkout | null> {
      return required(
        await attempt(() => store.findExisting(dedupeKey, contentHash)),
      );
    },
    async recordReceived(workout: ReceivedWorkout): Promise<void> {
      required(await attempt(() => store.recordReceived(workout)));
    },
    async recordResult(
      dedupeKey: string,
      result: WorkoutResult,
    ): Promise<void> {
      required(await attempt(() => store.recordResult(dedupeKey, result)));
    },
    async getHistoryContext(
      summary: WorkoutSummary,
      startedAt: Timestamp,
    ): Promise<HistoryContext> {
      return required(
        await attempt(() => store.getHistoryContext(summary, startedAt)),
      );
    },
  };
}

function required<T>(result: Attempt<T>): T {
  if (!result.ok) {
    throw new InternalError();
  }
  return result.value;
}
