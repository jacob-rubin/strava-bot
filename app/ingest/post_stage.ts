/** Ingest steps 7 and 8 (docs/reference/ingest-api.md): the Strava call and the terminal record it produces. */

import type { ActivityText, WorkoutSummary } from "../models.js";
import type { ActivityClient } from "../ports/activity_client.js";
import type {
  CreateActivityResult,
  StructuredWorkoutInput,
} from "../strava.js";
import { attempt } from "../util/attempt.js";
import { StravaRejectedError, stravaReason } from "./error.js";
import type { RequiredWorkoutStore } from "./required_store.js";
import type { WorkoutTiming } from "./workout_timing.js";

export interface PostStageInput {
  readonly strava: ActivityClient;
  readonly store: RequiredWorkoutStore;
  readonly resultDedupeKey: string;
  readonly activityText: ActivityText;
  readonly startDateLocal: string;
  readonly summary: WorkoutSummary;
  readonly timing: WorkoutTiming;
}

export async function postWorkoutActivity({
  strava,
  store,
  resultDedupeKey,
  activityText,
  startDateLocal,
  summary,
  timing,
}: PostStageInput): Promise<CreateActivityResult> {
  const created = await attempt(() => {
    const structuredWorkout: StructuredWorkoutInput = {
      start_time_utc: timing.startedAtUtc,
      utc_offset: timing.utcOffsetSeconds,
      exercises: summary.exercises,
    };
    return strava.createActivity(
      {
        name: activityText.title,
        description: activityText.description,
        start_date_local: startDateLocal,
        elapsed_time: timing.elapsedS,
      },
      structuredWorkout,
    );
  });

  if (!created.ok) {
    await store.recordResult(resultDedupeKey, {
      status: "failed",
      strava: null,
      error: stravaReason(created.error),
    });
    throw new StravaRejectedError(created.error);
  }

  const result = created.value;
  await store.recordResult(resultDedupeKey, {
    status: "posted",
    strava: {
      activity_id: result.id,
      upload_id: result.upload_id ?? null,
      url: result.url,
      method: result.method ?? "activities",
    },
    error: null,
  });
  return result;
}
