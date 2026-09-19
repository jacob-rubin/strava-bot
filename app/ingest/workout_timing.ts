/** §3 duration and §7.4 start-time derivation for one parsed workout. */

import { Timestamp } from "@google-cloud/firestore";
import { DateTime } from "luxon";

import type { Workout, WorkoutSummary } from "../models.js";
import { elapsedSeconds } from "../parser.js";
import type { IngestSettings } from "../ports/ingest_settings.js";
import { InternalError } from "./error.js";

export interface WorkoutTiming {
  readonly startedAt: Timestamp;
  readonly startedAtUtc: string;
  readonly utcOffsetSeconds: number;
  readonly elapsedS: number;
}

export interface WorkoutTimingInput {
  readonly workout: Workout;
  readonly summary: WorkoutSummary;
  readonly receivedAt: DateTime;
  readonly settings: Pick<IngestSettings, "localTz" | "elapsedCapS">;
}

export function deriveWorkoutTiming({
  workout,
  summary,
  receivedAt,
  settings,
}: WorkoutTimingInput): WorkoutTiming {
  const startedAtLocal = DateTime.fromISO(workout.started_at, {
    zone: settings.localTz,
  });
  const startedAtUtc = startedAtLocal
    .toUTC()
    .toISO({ suppressMilliseconds: true });
  if (startedAtUtc === null) {
    throw new InternalError();
  }

  return {
    startedAt: Timestamp.fromDate(startedAtLocal.toJSDate()),
    startedAtUtc,
    utcOffsetSeconds: startedAtLocal.offset * 60,
    elapsedS: elapsedSeconds(
      workout.started_at,
      receivedAt,
      summary.total_sets,
      settings.elapsedCapS,
    ),
  };
}
