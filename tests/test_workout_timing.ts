/** R-005 companion for app/ingest/workout_timing.ts (duration and Strava start time). */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { InternalError } from "../app/ingest/error.js";
import { deriveWorkoutTiming } from "../app/ingest/workout_timing.js";
import type { Workout, WorkoutSummary } from "../app/models.js";

const SETTINGS = { localTz: "America/Chicago", elapsedCapS: 14_400 } as const;

function workout(startedAt: string): Workout {
  return {
    workout_name: "Deadlift day",
    started_at: startedAt,
    exercises: [],
    share_slug: null,
    warnings: [],
  };
}

function summary(totalSets: number): WorkoutSummary {
  return {
    workout_name: "Deadlift day",
    started_at: "2026-09-09T06:43:00",
    total_volume: 0,
    total_reps: 0,
    total_sets: totalSets,
    exercises: [],
  };
}

function receivedAt(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: SETTINGS.localTz });
}

describe("deriveWorkoutTiming elapsed seconds", () => {
  it("uses the receipt delta when it is inside the cap", () => {
    const timing = deriveWorkoutTiming({
      workout: workout("2026-09-09T06:43:00"),
      summary: summary(3),
      receivedAt: receivedAt("2026-09-09T07:43:00"),
      settings: SETTINGS,
    });

    expect(timing.elapsedS).toBe(3_600);
  });

  it("falls back to the per-set estimate when the delta exceeds the cap", () => {
    const timing = deriveWorkoutTiming({
      workout: workout("2026-09-09T06:43:00"),
      summary: summary(12),
      receivedAt: receivedAt("2026-09-10T06:43:00"),
      settings: SETTINGS,
    });

    expect(timing.elapsedS).toBe(1_980);
  });

  it("honours a lowered cap from settings", () => {
    const timing = deriveWorkoutTiming({
      workout: workout("2026-09-09T06:43:00"),
      summary: summary(2),
      receivedAt: receivedAt("2026-09-09T07:43:00"),
      settings: { localTz: SETTINGS.localTz, elapsedCapS: 60 },
    });

    expect(timing.elapsedS).toBe(600);
  });
});

describe("deriveWorkoutTiming start time", () => {
  it("resolves a daylight-saving start time to UTC without milliseconds", () => {
    const timing = deriveWorkoutTiming({
      workout: workout("2026-09-09T06:43:00"),
      summary: summary(3),
      receivedAt: receivedAt("2026-09-09T07:43:00"),
      settings: SETTINGS,
    });

    expect(timing.startedAtUtc).toBe("2026-09-09T11:43:00Z");
    expect(timing.utcOffsetSeconds).toBe(-18_000);
    expect(timing.startedAt.toDate().toISOString()).toBe(
      "2026-09-09T11:43:00.000Z",
    );
  });

  it("resolves a standard-time start time with its own offset", () => {
    const timing = deriveWorkoutTiming({
      workout: workout("2026-01-09T06:43:00"),
      summary: summary(3),
      receivedAt: receivedAt("2026-01-09T07:43:00"),
      settings: SETTINGS,
    });

    expect(timing.startedAtUtc).toBe("2026-01-09T12:43:00Z");
    expect(timing.utcOffsetSeconds).toBe(-21_600);
  });

  it("raises InternalError when the start time cannot be resolved", () => {
    expect(() =>
      deriveWorkoutTiming({
        workout: workout("not a timestamp"),
        summary: summary(3),
        receivedAt: receivedAt("2026-09-09T07:43:00"),
        settings: SETTINGS,
      }),
    ).toThrow(InternalError);
  });
});
