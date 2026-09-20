/** R-005 companion for app/ingest/post_stage.ts (ingest steps 7 and 8). */
import { Timestamp } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import {
  InternalError,
  StravaRejectedError,
} from "../app/ingest/error.js";
import { postWorkoutActivity } from "../app/ingest/post_stage.js";
import type { RequiredWorkoutStore } from "../app/ingest/required_store.js";
import type { WorkoutTiming } from "../app/ingest/workout_timing.js";
import type { ActivityText, WorkoutSummary } from "../app/models.js";
import type { ActivityClient } from "../app/ports/activity_client.js";
import type {
  CreateActivityInput,
  CreateActivityResult,
  StructuredWorkoutInput,
} from "../app/strava.js";
import type { WorkoutResult } from "../app/store.js";

const ACTIVITY_TEXT: ActivityText = {
  title: "Deadlift day",
  description: "3 sets · 12 reps",
};
const SUMMARY: WorkoutSummary = {
  workout_name: "Deadlift day",
  started_at: "2026-09-09T06:43:00",
  total_volume: 3_780,
  total_reps: 12,
  total_sets: 3,
  exercises: [],
};
const TIMING: WorkoutTiming = {
  startedAt: Timestamp.fromDate(new Date("2026-09-09T11:43:00Z")),
  startedAtUtc: "2026-09-09T11:43:00Z",
  utcOffsetSeconds: -18_000,
  elapsedS: 3_600,
};

class RecordingClient implements ActivityClient {
  readonly calls: Array<{
    activity: CreateActivityInput;
    structuredWorkout: StructuredWorkoutInput | undefined;
  }> = [];

  constructor(
    private readonly outcome: CreateActivityResult | Error,
  ) {}

  async createActivity(
    activity: CreateActivityInput,
    structuredWorkout?: StructuredWorkoutInput,
  ): Promise<CreateActivityResult> {
    this.calls.push({ activity, structuredWorkout });
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

class RecordingStore implements RequiredWorkoutStore {
  readonly results: Array<{ dedupeKey: string; result: WorkoutResult }> = [];
  failWrite = false;

  async findExisting(): Promise<null> {
    return null;
  }

  async recordReceived(): Promise<void> {}

  async recordResult(
    dedupeKey: string,
    result: WorkoutResult,
  ): Promise<void> {
    if (this.failWrite) {
      throw new InternalError();
    }
    this.results.push({ dedupeKey, result });
  }

  async getHistoryContext(): Promise<never> {
    throw new Error("not used");
  }
}

function post(
  strava: ActivityClient,
  store: RequiredWorkoutStore,
): Promise<CreateActivityResult> {
  return postWorkoutActivity({
    strava,
    store,
    resultDedupeKey: "strong:k3m8q2xz",
    activityText: ACTIVITY_TEXT,
    startDateLocal: SUMMARY.started_at,
    summary: SUMMARY,
    timing: TIMING,
  });
}

describe("postWorkoutActivity", () => {
  it("posts structured context and records a successful activity", async () => {
    const strava = new RecordingClient({ id: "123", url: "/activities/123" });
    const store = new RecordingStore();

    await expect(post(strava, store)).resolves.toEqual({
      id: "123",
      url: "/activities/123",
    });
    expect(strava.calls).toEqual([
      {
        activity: {
          name: ACTIVITY_TEXT.title,
          description: ACTIVITY_TEXT.description,
          start_date_local: SUMMARY.started_at,
          elapsed_time: TIMING.elapsedS,
        },
        structuredWorkout: {
          start_time_utc: TIMING.startedAtUtc,
          utc_offset: TIMING.utcOffsetSeconds,
          exercises: SUMMARY.exercises,
        },
      },
    ]);
    expect(store.results).toEqual([
      {
        dedupeKey: "strong:k3m8q2xz",
        result: {
          status: "posted",
          strava: {
            activity_id: "123",
            upload_id: null,
            url: "/activities/123",
            method: "activities",
          },
          error: null,
        },
      },
    ]);
  });

  it("records a Strava failure before throwing StravaRejectedError", async () => {
    const strava = new RecordingClient(new Error("provider unavailable"));
    const store = new RecordingStore();

    await expect(post(strava, store)).rejects.toBeInstanceOf(
      StravaRejectedError,
    );
    expect(store.results).toEqual([
      {
        dedupeKey: "strong:k3m8q2xz",
        result: {
          status: "failed",
          strava: null,
          error: "provider unavailable",
        },
      },
    ]);
  });

  it("surfaces a store failure while recording success as InternalError", async () => {
    const strava = new RecordingClient({ id: "123", url: "/activities/123" });
    const store = new RecordingStore();
    store.failWrite = true;

    await expect(post(strava, store)).rejects.toBeInstanceOf(InternalError);
  });

  it("surfaces a store failure while recording rejection as InternalError", async () => {
    const strava = new RecordingClient(new Error("provider unavailable"));
    const store = new RecordingStore();
    store.failWrite = true;

    await expect(post(strava, store)).rejects.toBeInstanceOf(InternalError);
  });
});
