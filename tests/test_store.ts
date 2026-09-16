import { Timestamp } from "@google-cloud/firestore";

import { describe, expect, it } from "vitest";

import type { Workout } from "../app/models.js";
import {
  WorkoutStore,
  type ReceivedWorkout,
  type StravaRecord,
  type WorkoutFirestore,
  type WorkoutQuery,
  type WorkoutQuerySnapshot,
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

interface StoreStub {
  firestore: WorkoutFirestore;
  documents: Map<string, Record<string, unknown>>;
}

function createStoreStub(): StoreStub {
  const documents = new Map<string, Record<string, unknown>>();

  const firestore: WorkoutFirestore = {
    collection: (collectionPath) => {
      if (collectionPath !== "workouts") {
        throw new Error(`Unexpected collection path: ${collectionPath}`);
      }

      return {
        doc: (id) => ({
          get: async () => {
            const data = documents.get(id);
            return { exists: data !== undefined, data: () => data };
          },
          set: async (data) => {
            documents.set(id, data);
            return {};
          },
          update: async (data) => {
            const existing = documents.get(id);
            if (existing === undefined) {
              throw new Error(`Document ${id} does not exist.`);
            }
            documents.set(id, { ...existing, ...data });
            return {};
          },
        }),
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
    },
  };

  return { firestore, documents };
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
  it("writes a fresh document with every §6 field and status received", async () => {
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
