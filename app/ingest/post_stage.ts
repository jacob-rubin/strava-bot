import type { ActivityText, WorkoutSummary } from "../models.js";
import type { ActivityClient } from "../ports/activity_client.js";
import type {
  ActivityUploadResult,
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
  readonly summary: WorkoutSummary;
  readonly timing: WorkoutTiming;
}

export async function postWorkoutActivity({
  strava,
  store,
  resultDedupeKey,
  activityText,
  summary,
  timing,
}: PostStageInput): Promise<ActivityUploadResult> {
  const created = await attempt(() => {
    const structuredWorkout: StructuredWorkoutInput = {
      start_time_utc: timing.startedAtUtc,
      utc_offset: timing.utcOffsetSeconds,
      exercises: summary.exercises,
    };
    return strava.uploadActivity(
      {
        name: activityText.title,
        description: activityText.description,
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
      upload_id: result.upload_id,
      url: result.url,
      method: "uploads",
    },
    error: null,
  });
  return result;
}
