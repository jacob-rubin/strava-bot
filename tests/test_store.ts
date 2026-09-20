import { Timestamp } from "@google-cloud/firestore";

import { describe, expect, it } from "vitest";

import type { Workout, WorkoutSet } from "../app/models.js";
import {
  WorkoutStore,
  type ReceivedWorkout,
  type StravaRecord,
  type WorkoutFirestore,
  type WorkoutQuery,
  type WorkoutQuerySnapshot,
  type WorkoutResult,
} from "../app/store.js";

const STARTED_AT = Timestamp.fromDate(new Date("2026-09-09T06:43:00Z"));
const RECEIVED_AT = Timestamp.fromDate(new Date("2026-09-09T07:00:00Z"));

const RAW_TEXT =
  "Early Morning Workout\n" +
  "Wednesday, September 9, 2026 at 6:43 AM\n\n" +
  "Deadlift (Barbell)\n" +
  "Set 1: 315 lb × 4\n" +
  "https://link.strong.app/k3m8q2xz";

const CONTENT_HASH = "sha256:abcdef0123456789abcdef0123456789";

const workout: Workout = {
  workout_name: "Early Morning Workout",
  started_at: "2026-09-09T06:43:00",
  exercises: [{ name: "Deadlift", equipment: "Barbell", sets: [] }],
  share_slug: "k3m8q2xz",
  warnings: [],
};

function receivedWorkout(
  overrides: Partial<ReceivedWorkout> = {},
): ReceivedWorkout {
  return {
    dedupe_key: "strong:k3m8q2xz",
    content_hash: CONTENT_HASH,
    raw_text: RAW_TEXT,
    parsed: workout,
    started_at: STARTED_AT,
    elapsed_s: 1020,
    received_at: RECEIVED_AT,
    ...overrides,
  };
}

function weightRepsSet(weight: number, reps: number): WorkoutSet {
  return {
    kind: "weight_reps",
    index: "1",
    is_warmup: false,
    volume: weight * reps,
    weight,
    unit: "lb",
    reps,
    duration_s: null,
    distance: null,
    distance_unit: null,
  };
}

function deadliftWorkout(weight: number, reps: number): Workout {
  return {
    workout_name: "Early Morning Workout",
    started_at: "2026-09-09T06:43:00",
    exercises: [
      {
        name: "Deadlift",
        equipment: "Barbell",
        sets: [weightRepsSet(weight, reps)],
      },
    ],
    share_slug: null,
    warnings: [],
  };
}

function postedResult(): WorkoutResult {
  return {
    status: "posted",
    strava: {
      activity_id: "1234567890",
      upload_id: null,
      url: "https://www.strava.com/activities/1234567890",
      method: "activities",
    },
    error: null,
  };
}

interface StoreStub {
  firestore: WorkoutFirestore;
  documents: Map<string, Record<string, unknown>>;
  historyDocuments: Map<string, Record<string, unknown>>;
}

function createStoreStub(): StoreStub {
  const documents = new Map<string, Record<string, unknown>>();
  const historyDocuments = new Map<string, Record<string, unknown>>();

  const workoutDoc = (id: string) => ({
    get: async () => {
      const data = documents.get(id);
      return { exists: data !== undefined, data: () => data };
    },
    set: async (data: Record<string, unknown>) => {
      documents.set(id, data);
      return {};
    },
    update: async (data: Record<string, unknown>) => {
      const existing = documents.get(id);
      if (existing === undefined) {
        throw new Error(`Document ${id} does not exist.`);
      }
      documents.set(id, { ...existing, ...data });
      return {};
    },
  });

  const historyDoc = (id: string) => ({
    get: async () => {
      const data = historyDocuments.get(id);
      return { exists: data !== undefined, data: () => data };
    },
    set: async (data: Record<string, unknown>) => {
      historyDocuments.set(id, data);
      return {};
    },
    update: async (data: Record<string, unknown>) => {
      const existing = historyDocuments.get(id);
      if (existing === undefined) {
        throw new Error(`History document ${id} does not exist.`);
      }
      historyDocuments.set(id, { ...existing, ...data });
      return {};
    },
  });

  const firestore: WorkoutFirestore = {
    collection: (collectionPath) => {
      if (collectionPath === "workouts") {
        return {
          doc: workoutDoc,
          where: (fieldPath, opStr, value) => {
            if (opStr !== "==") {
              throw new Error(`Unexpected where operator: ${opStr}`);
            }
            return makeQuery((limit) => {
              const matches = [...documents.entries()]
                .filter(([, data]) => data[fieldPath] === value);
              const limited = limit === null ? matches : matches.slice(0, limit);
              return {
                empty: limited.length === 0,
                docs: limited.map(([, data]) => ({ data: () => data })),
              };
            });
          },
        };
      }

      if (collectionPath === "history") {
        return {
          doc: historyDoc,
          where: () => {
            throw new Error("history collection does not support where.");
          },
        };
      }

      throw new Error(`Unexpected collection path: ${collectionPath}`);
    },
  };

  return { firestore, documents, historyDocuments };
}

function makeQuery(
  run: (limit: number | null) => WorkoutQuerySnapshot,
): WorkoutQuery {
  const build = (limit: number | null): WorkoutQuery => ({
    limit: (n: number) => build(n),
    get: () => Promise.resolve(run(limit)),
  });
  return build(null);
}

describe("WorkoutStore", () => {
  it("writes a fresh document with every persisted field and status received", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await store.recordReceived(receivedWorkout());

    const stored = stub.documents.get("strong:k3m8q2xz");
    expect(stored).toMatchObject({
      dedupe_key: "strong:k3m8q2xz",
      content_hash: CONTENT_HASH,
      raw_text: RAW_TEXT,
      parsed: workout,
      started_at: STARTED_AT,
      elapsed_s: 1020,
      received_at: RECEIVED_AT,
      title: null,
      description: null,
      strava: null,
      status: "received",
      error: null,
      attempts: 0,
    });
    expect(stored?.["raw_text"]).toBe(RAW_TEXT);
  });

  it("returns the document when the dedupe key matches", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);
    await store.recordReceived(receivedWorkout());

    await expect(
      store.findExisting("strong:k3m8q2xz", "sha256:other"),
    ).resolves.toMatchObject({ dedupe_key: "strong:k3m8q2xz" });
  });

  it("falls back to the content_hash query when the dedupe key differs", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);
    await store.recordReceived(
      receivedWorkout({ dedupe_key: "strong:first-slug" }),
    );

    await expect(
      store.findExisting("strong:second-slug", CONTENT_HASH),
    ).resolves.toMatchObject({ dedupe_key: "strong:first-slug" });
  });

  it("returns null when neither lookup finds a document", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await expect(
      store.findExisting("strong:missing", "sha256:missing"),
    ).resolves.toBeNull();
  });

  it("still persists raw_text when parsing failed", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);
    const unparseable = "this is not a strong share";

    await store.recordReceived({
      dedupe_key: "sha256:parse-failure",
      content_hash: "sha256:parse-failure",
      raw_text: unparseable,
      parsed: null,
      started_at: null,
      elapsed_s: null,
      received_at: RECEIVED_AT,
    });

    const stored = stub.documents.get("sha256:parse-failure");
    expect(stored).toMatchObject({
      dedupe_key: "sha256:parse-failure",
      raw_text: unparseable,
      parsed: null,
      started_at: null,
      elapsed_s: null,
      status: "received",
    });
    expect(stored?.["raw_text"]).toBe(unparseable);
  });

  it("records a posted outcome with status, strava, and an incremented attempts", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);
    await store.recordReceived(receivedWorkout());

    const strava: StravaRecord = {
      activity_id: "1234567890",
      upload_id: null,
      url: "https://www.strava.com/activities/1234567890",
      method: "activities",
    };

    await store.recordResult("strong:k3m8q2xz", {
      status: "posted",
      strava,
      error: null,
    });

    expect(stub.documents.get("strong:k3m8q2xz")).toMatchObject({
      status: "posted",
      strava,
      error: null,
      attempts: 1,
    });
  });

  it("records a failed outcome with error and an incremented attempts", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);
    await store.recordReceived(receivedWorkout());

    await store.recordResult("strong:k3m8q2xz", {
      status: "failed",
      strava: null,
      error: "Strava rate limit exceeded.",
    });

    expect(stub.documents.get("strong:k3m8q2xz")).toMatchObject({
      status: "failed",
      strava: null,
      error: "Strava rate limit exceeded.",
      attempts: 1,
    });
  });

  it("lets Firestore errors propagate without swallowing them", async () => {
    const boom = new Error("firestore down");
    const firestore: WorkoutFirestore = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw boom;
          },
          set: async () => {
            throw boom;
          },
          update: async () => {
            throw boom;
          },
        }),
        where: () =>
          makeQuery(() => {
            throw boom;
          }),
      }),
    };
    const store = new WorkoutStore(firestore);

    await expect(store.findExisting("strong:x", "sha256:x")).rejects.toBe(boom);
    await expect(store.recordReceived(receivedWorkout())).rejects.toBe(boom);
  });
});

describe("history", () => {
  it("creates a document on the first successful post for an exercise", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await store.recordReceived(
      receivedWorkout({
        dedupe_key: "strong:first",
        parsed: deadliftWorkout(315, 4),
      }),
    );
    await store.recordResult("strong:first", postedResult());

    expect(stub.historyDocuments.get("Deadlift")).toMatchObject({
      exercise_name: "Deadlift",
      best_e1rm: 357,
      best_top_set: { weight: 315, unit: "lb", reps: 4 },
      last_performed: STARTED_AT,
      recent: [
        {
          date: STARTED_AT,
          top_set: { weight: 315, unit: "lb", reps: 4 },
          volume: 1260,
        },
      ],
    });
  });

  it("appends to recent on a second workout for the same exercise", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await store.recordReceived(
      receivedWorkout({
        dedupe_key: "strong:first",
        parsed: deadliftWorkout(315, 4),
      }),
    );
    await store.recordResult("strong:first", postedResult());

    await store.recordReceived(
      receivedWorkout({
        dedupe_key: "strong:second",
        parsed: deadliftWorkout(320, 5),
      }),
    );
    await store.recordResult("strong:second", postedResult());

    const stored = stub.historyDocuments.get("Deadlift");
    expect(stored).toMatchObject({
      best_top_set: { weight: 320, unit: "lb", reps: 5 },
    });
    expect(stored?.["best_e1rm"]).toBeCloseTo(320 * (1 + 5 / 30), 6);

    const recent = stored?.["recent"] as Array<Record<string, unknown>>;
    expect(recent).toHaveLength(2);
    expect(recent[1]).toMatchObject({
      date: STARTED_AT,
      top_set: { weight: 320, unit: "lb", reps: 5 },
      volume: 1600,
    });
  });

  it("caps recent at the last 10 entries", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    for (let i = 1; i <= 11; i += 1) {
      await store.recordReceived(
        receivedWorkout({
          dedupe_key: `strong:workout-${i}`,
          parsed: deadliftWorkout(300 + i, 4),
        }),
      );
      await store.recordResult(`strong:workout-${i}`, postedResult());
    }

    const stored = stub.historyDocuments.get("Deadlift");
    const recent = stored?.["recent"] as Array<Record<string, unknown>>;
    expect(recent).toHaveLength(10);
    expect(recent[0]).toMatchObject({
      top_set: { weight: 302, unit: "lb", reps: 4 },
    });
    expect(recent[9]).toMatchObject({
      top_set: { weight: 311, unit: "lb", reps: 4 },
    });
  });

  it("does not write history when the post failed", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await store.recordReceived(
      receivedWorkout({
        dedupe_key: "strong:failed",
        parsed: deadliftWorkout(315, 4),
      }),
    );
    await store.recordResult("strong:failed", {
      status: "failed",
      strava: null,
      error: "Strava rate limit exceeded.",
    });

    expect(stub.historyDocuments.size).toBe(0);
  });

  it("reads a stored document and returns null when the exercise is unseen", async () => {
    const stub = createStoreStub();
    const store = new WorkoutStore(stub.firestore);

    await expect(store.getExerciseHistory("Deadlift")).resolves.toBeNull();

    await store.recordReceived(
      receivedWorkout({
        dedupe_key: "strong:first",
        parsed: deadliftWorkout(315, 4),
      }),
    );
    await store.recordResult("strong:first", postedResult());

    await expect(store.getExerciseHistory("Deadlift")).resolves.toMatchObject({
      exercise_name: "Deadlift",
      best_e1rm: 357,
    });
  });
});
