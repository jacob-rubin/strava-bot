/** R-005 companion for app/ingest/required_store.ts (constraint 11). */
import { Timestamp } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { InternalError } from "../app/ingest/error.js";
import { requiredStore } from "../app/ingest/required_store.js";
import type { HistoryContext, WorkoutSummary } from "../app/models.js";
import type { WorkoutStoreLike } from "../app/ports/workout_store_like.js";
import type {
  ReceivedWorkout,
  StoredWorkout,
  WorkoutResult,
} from "../app/store.js";

const SUMMARY: WorkoutSummary = {
  workout_name: "Deadlift day",
  started_at: "2026-09-09T06:43:00",
  total_volume: 3_780,
  total_reps: 12,
  total_sets: 3,
  exercises: [],
};

const HISTORY: HistoryContext = { per_exercise: {}, pr_flags: {} };
const STARTED_AT = Timestamp.fromDate(new Date("2026-09-09T11:43:00Z"));

const RECEIVED: ReceivedWorkout = {
  dedupe_key: "strong:gvvdfvga",
  content_hash: "sha256:abc",
  raw_text: "Deadlift day\n",
  parsed: null,
  started_at: null,
  elapsed_s: null,
  received_at: STARTED_AT,
};

const RESULT: WorkoutResult = { status: "posted", strava: null, error: null };

const STORED: StoredWorkout = {
  dedupe_key: "strong:gvvdfvga",
  content_hash: "sha256:abc",
  raw_text: "Deadlift day\n",
  parsed: null,
  started_at: null,
  elapsed_s: null,
  received_at: STARTED_AT,
  title: null,
  description: null,
  strava: null,
  status: "received",
  error: null,
  attempts: 0,
};

class RecordingStore implements WorkoutStoreLike {
  readonly calls: string[] = [];

  async findExisting(
    dedupeKey: string,
    contentHash: string,
  ): Promise<StoredWorkout | null> {
    this.calls.push(`findExisting:${dedupeKey}:${contentHash}`);
    return STORED;
  }

  async recordReceived(workout: ReceivedWorkout): Promise<void> {
    this.calls.push(`recordReceived:${workout.dedupe_key}`);
  }

  async recordResult(dedupeKey: string, result: WorkoutResult): Promise<void> {
    this.calls.push(`recordResult:${dedupeKey}:${result.status}`);
  }

  async getHistoryContext(
    summary: WorkoutSummary,
    startedAt: Timestamp,
  ): Promise<HistoryContext> {
    this.calls.push(`getHistoryContext:${summary.workout_name}:${startedAt.seconds}`);
    return HISTORY;
  }
}

function rejectingStore(): WorkoutStoreLike {
  const fail = async (): Promise<never> => {
    throw new Error("firestore unavailable");
  };
  return {
    findExisting: fail,
    recordReceived: fail,
    recordResult: fail,
    getHistoryContext: fail,
  };
}

describe("requiredStore delegation", () => {
  it("passes every call through to the wrapped store and returns its value", async () => {
    const inner = new RecordingStore();
    const store = requiredStore(inner);

    expect(await store.findExisting("strong:gvvdfvga", "sha256:abc")).toBe(
      STORED,
    );
    await store.recordReceived(RECEIVED);
    await store.recordResult("strong:gvvdfvga", RESULT);
    expect(await store.getHistoryContext(SUMMARY, STARTED_AT)).toBe(HISTORY);

    expect(inner.calls).toEqual([
      "findExisting:strong:gvvdfvga:sha256:abc",
      "recordReceived:strong:gvvdfvga",
      "recordResult:strong:gvvdfvga:posted",
      `getHistoryContext:Deadlift day:${STARTED_AT.seconds}`,
    ]);
  });
});

describe("requiredStore failure mapping", () => {
  it("turns a findExisting rejection into InternalError", async () => {
    const store = requiredStore(rejectingStore());
    await expect(store.findExisting("k", "h")).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("turns a recordReceived rejection into InternalError", async () => {
    const store = requiredStore(rejectingStore());
    await expect(store.recordReceived(RECEIVED)).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("turns a recordResult rejection into InternalError", async () => {
    const store = requiredStore(rejectingStore());
    await expect(store.recordResult("k", RESULT)).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("turns a getHistoryContext rejection into InternalError", async () => {
    const store = requiredStore(rejectingStore());
    await expect(
      store.getHistoryContext(SUMMARY, STARTED_AT),
    ).rejects.toBeInstanceOf(InternalError);
  });
});
