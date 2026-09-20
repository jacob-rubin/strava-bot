import { Timestamp } from "@google-cloud/firestore";
import type { DateTime } from "luxon";

import type { Workout } from "../models.js";
import { ParseError, parseWorkout } from "../parser.js";
import { attemptSync } from "../util/attempt.js";
import { rawTextHash } from "../util/ingest.js";
import { InternalError, UnparseableWorkoutError } from "./error.js";
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
    return parsed.value;
  }
  if (!(parsed.error instanceof ParseError)) {
    throw new InternalError();
  }

  const parseFailureKey = rawTextHash(rawText);
  // Constraint 6: persist before rejecting so a fixed parser can re-parse.
  await store.recordReceived({
    dedupe_key: parseFailureKey,
    content_hash: parseFailureKey,
    raw_text: rawText,
    parsed: null,
    started_at: null,
    elapsed_s: null,
    received_at: Timestamp.fromDate(receivedAt.toJSDate()),
  });
  throw new UnparseableWorkoutError();
}
