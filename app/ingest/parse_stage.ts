import { Timestamp } from "@google-cloud/firestore";
import type { DateTime } from "luxon";

import type { Workout } from "../models.js";
import { ParseError, parseWorkout } from "../parser.js";
import { attemptSync } from "../util/attempt.js";
import { rawTextHash } from "../util/ingest.js";
import {
  InternalError,
  UnparseableWorkoutError,
  UnuploadableWorkoutError,
} from "./error.js";
import type { RequiredWorkoutStore } from "./required_store.js";

export interface ParseStageInput {
  readonly store: RequiredWorkoutStore;
  readonly rawText: string;
  readonly receivedAt: DateTime;
}

export async function parseWorkoutOrRecordRaw({
  store,
  rawText,
  receivedAt,
}: ParseStageInput): Promise<Workout> {
  const parsed = attemptSync(() => parseWorkout(rawText));
  if (parsed.ok) {
    if (hasAnySet(parsed.value)) {
      return parsed.value;
    }
    await recordRawOnly({ store, rawText, receivedAt });
    throw new UnuploadableWorkoutError();
  }
  if (!(parsed.error instanceof ParseError)) {
    throw new InternalError();
  }
  await recordRawOnly({ store, rawText, receivedAt });
  throw new UnparseableWorkoutError();
}

/** Warmup sets count: the structured upload needs a non-empty sets array, nothing more. */
function hasAnySet(workout: Workout): boolean {
  return workout.exercises.some((exercise) => exercise.sets.length > 0);
}

/**
 * Constraint 6: persist before rejecting so a fixed parser can re-parse. Keyed by the
 * raw-text hash, never the workout's dedupe key — a "received" record under the real
 * key would answer a re-share with "already posted" and no URL.
 */
async function recordRawOnly({
  store,
  rawText,
  receivedAt,
}: ParseStageInput): Promise<void> {
  const rawKey = rawTextHash(rawText);
  await store.recordReceived({
    dedupe_key: rawKey,
    content_hash: rawKey,
    raw_text: rawText,
    parsed: null,
    started_at: null,
    elapsed_s: null,
    received_at: Timestamp.fromDate(receivedAt.toJSDate()),
  });
}
