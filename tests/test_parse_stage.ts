/** R-005 companion for app/ingest/parse_stage.ts (constraint 6 / ingest step 3). */
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/parser.js", async (importOriginal) => {
  const parser = await importOriginal<typeof import("../app/parser.js")>();
  return { ...parser, parseWorkout: vi.fn(parser.parseWorkout) };
});

import {
  InternalError,
  UnparseableWorkoutError,
  UnuploadableWorkoutError,
} from "../app/ingest/error.js";
import { parseWorkoutOrRecordRaw } from "../app/ingest/parse_stage.js";
import type { RequiredWorkoutStore } from "../app/ingest/required_store.js";
import { parseWorkout } from "../app/parser.js";
import type { ReceivedWorkout } from "../app/store.js";
import { rawTextHash } from "../app/util/ingest.js";

const VALID_TEXT =
  "Deadlift day\n" +
  "Wednesday, September 9, 2026 at 6:43 AM\n" +
  "\n" +
  "Deadlift (Barbell)\n" +
  "Set 1: 315 lb × 4\n";
/** Parses cleanly — title and date line — but carries no set for the upload. */
const NO_SETS_TEXT =
  "Deadlift day\n" +
  "Wednesday, September 9, 2026 at 6:43 AM\n" +
  "\n" +
  "Deadlift (Barbell)\n";
const WARMUP_ONLY_TEXT =
  "Deadlift day\n" +
  "Wednesday, September 9, 2026 at 6:43 AM\n" +
  "\n" +
  "Deadlift (Barbell)\n" +
  "Set W: 135 lb × 8\n";
const RECEIVED_AT = DateTime.fromISO("2026-09-09T07:43:00", {
  zone: "America/Chicago",
});

class RecordingStore implements RequiredWorkoutStore {
  readonly received: ReceivedWorkout[] = [];
  failWrite = false;

  async findExisting(): Promise<null> {
    return null;
  }

  async recordReceived(workout: ReceivedWorkout): Promise<void> {
    if (this.failWrite) {
      throw new InternalError();
    }
    this.received.push(workout);
  }

  async recordResult(): Promise<void> {}

  async getHistoryContext(): Promise<never> {
    throw new Error("not used");
  }
}

afterEach(() => {
  vi.mocked(parseWorkout).mockClear();
});

describe("parseWorkoutOrRecordRaw", () => {
  it("returns a valid workout without writing a raw-only record", async () => {
    const store = new RecordingStore();

    const workout = await parseWorkoutOrRecordRaw({
      store,
      rawText: VALID_TEXT,
      receivedAt: RECEIVED_AT,
    });

    expect(workout.workout_name).toBe("Deadlift day");
    expect(workout.started_at).toBe("2026-09-09T06:43:00");
    expect(store.received).toEqual([]);
  });

  it("persists an unparseable payload before rejecting it", async () => {
    const store = new RecordingStore();
    const rawText = "not a Strong workout";

    await expect(
      parseWorkoutOrRecordRaw({ store, rawText, receivedAt: RECEIVED_AT }),
    ).rejects.toBeInstanceOf(UnparseableWorkoutError);

    const key = rawTextHash(rawText);
    expect(store.received).toEqual([
      {
        dedupe_key: key,
        content_hash: key,
        raw_text: rawText,
        parsed: null,
        started_at: null,
        elapsed_s: null,
        received_at: expect.anything(),
      },
    ]);
    expect(store.received[0]?.received_at.toDate().toISOString()).toBe(
      "2026-09-09T12:43:00.000Z",
    );
  });

  it("surfaces a required-store failure as InternalError", async () => {
    const store = new RecordingStore();
    store.failWrite = true;

    await expect(
      parseWorkoutOrRecordRaw({
        store,
        rawText: "not a Strong workout",
        receivedAt: RECEIVED_AT,
      }),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it("maps an unexpected parser exception to InternalError without writing", async () => {
    const store = new RecordingStore();
    vi.mocked(parseWorkout).mockImplementationOnce(() => {
      throw new Error("unexpected parser defect");
    });

    await expect(
      parseWorkoutOrRecordRaw({
        store,
        rawText: VALID_TEXT,
        receivedAt: RECEIVED_AT,
      }),
    ).rejects.toBeInstanceOf(InternalError);
    expect(store.received).toEqual([]);
  });

  // The structured upload is the only Strava path and needs a non-empty sets array.
  it("persists a parsed but set-less payload under the raw-text hash before rejecting", async () => {
    const store = new RecordingStore();

    await expect(
      parseWorkoutOrRecordRaw({
        store,
        rawText: NO_SETS_TEXT,
        receivedAt: RECEIVED_AT,
      }),
    ).rejects.toBeInstanceOf(UnuploadableWorkoutError);

    const key = rawTextHash(NO_SETS_TEXT);
    // Never the workout's own dedupe key: a "received" record there would make
    // a re-share answer "already posted" with no URL.
    expect(store.received).toEqual([
      {
        dedupe_key: key,
        content_hash: key,
        raw_text: NO_SETS_TEXT,
        parsed: null,
        started_at: null,
        elapsed_s: null,
        received_at: expect.anything(),
      },
    ]);
  });

  it("accepts a warmup-only workout, which still has a set to upload", async () => {
    const store = new RecordingStore();

    const workout = await parseWorkoutOrRecordRaw({
      store,
      rawText: WARMUP_ONLY_TEXT,
      receivedAt: RECEIVED_AT,
    });

    expect(workout.exercises[0]?.sets[0]?.is_warmup).toBe(true);
    expect(store.received).toEqual([]);
  });
});
