/**
 * Ingest acceptance bullets from docs/reference/ingest-api.md.
 *
 * The route is exercised through Fastify's `app.inject` with Firestore and
 * Strava replaced by in-memory stubs at their module boundaries; the local
 * deterministic formatter is the real implementation, so the complete MVP
 * request path runs with only those two external services.
 */
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RequestLog } from "../app/logging.js";
import { createApp, type CreateAppOptions } from "../app/main.js";
import type { HistoryContext } from "../app/models.js";
import type { ActivityClient } from "../app/ports/activity_client.js";
import type { IngestSettings } from "../app/ports/ingest_settings.js";
import type { WorkoutStoreLike } from "../app/ports/workout_store_like.js";
import type {
  ReceivedWorkout,
  StoredWorkout,
  WorkoutResult,
} from "../app/store.js";
import {
  StravaApiError,
  type ActivityUploadInput,
  type ActivityUploadResult,
  type StructuredWorkoutInput,
} from "../app/strava.js";
import { rawTextHash } from "../app/util/ingest.js";

const VALID_SHARE_TEXT =
  "Deadlift day\n" +
  "Wednesday, September 9, 2026 at 6:43 AM\n\n" +
  "Deadlift (Barbell)\n" +
  "Set 1: 315 lb \u00d7 4\n" +
  "Set 2: 315 lb \u00d7 4\n" +
  "Set 3: 315 lb \u00d7 4\n" +
  "https://link.strong.app/k3m8q2xz\n";

function shareTextWithSlug(slug: string): string {
  return VALID_SHARE_TEXT.replace(
    "https://link.strong.app/k3m8q2xz",
    `https://link.strong.app/${slug}`,
  );
}

// The route reads the wall clock directly, so the suite freezes it instead of
// injecting one: `received_at` and `elapsed_s` stay deterministic as the
// fixture date recedes into the past. Only `Date` is faked, so Fastify's
// `inject` and any real timers keep working.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-09T12:43:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

class FakeSettings implements IngestSettings {
  readonly localTz = "America/Chicago";
  readonly maxBodyBytes = 65_536;
  readonly elapsedCapS = 14_400;

  constructor(
    readonly ingestKey = "correct-key",
    readonly pathToken = "correct-token",
  ) {}

  async getIngestKey(): Promise<string> {
    return this.ingestKey;
  }

  async getIngestPathToken(): Promise<string> {
    return this.pathToken;
  }
}

class FakeStore implements WorkoutStoreLike {
  readonly received: ReceivedWorkout[] = [];
  readonly results: { dedupeKey: string; result: WorkoutResult }[] = [];
  readonly docs = new Map<string, StoredWorkout>();
  historyContext: HistoryContext = { per_exercise: {}, pr_flags: {} };

  async getHistoryContext(): Promise<HistoryContext> {
    return this.historyContext;
  }

  async findExisting(
    dedupeKey: string,
    contentHash: string,
  ): Promise<StoredWorkout | null> {
    const byKey = this.docs.get(dedupeKey);
    if (byKey !== undefined) {
      return byKey;
    }

    for (const doc of this.docs.values()) {
      if (doc.content_hash === contentHash) {
        return doc;
      }
    }
    return null;
  }

  async recordReceived(workout: ReceivedWorkout): Promise<void> {
    this.received.push(workout);
    this.docs.set(workout.dedupe_key, {
      dedupe_key: workout.dedupe_key,
      content_hash: workout.content_hash,
      raw_text: workout.raw_text,
      parsed: workout.parsed,
      started_at: workout.started_at,
      elapsed_s: workout.elapsed_s,
      received_at: workout.received_at,
      title: null,
      description: null,
      strava: null,
      status: "received",
      error: null,
      attempts: 0,
    });
  }

  async recordResult(dedupeKey: string, result: WorkoutResult): Promise<void> {
    this.results.push({ dedupeKey, result });
    const doc = this.docs.get(dedupeKey);
    if (doc !== undefined) {
      doc.status = result.status;
      doc.strava = result.strava;
      doc.error = result.error;
      doc.attempts += 1;
    }
  }
}

class FakeStrava implements ActivityClient {
  readonly calls: ActivityUploadInput[] = [];
  readonly workouts: StructuredWorkoutInput[] = [];
  nextResult: ActivityUploadResult = {
    id: "1234567890",
    url: "https://www.strava.com/activities/1234567890",
    upload_id: "987",
  };
  nextError: unknown = null;

  async uploadActivity(
    activity: ActivityUploadInput,
    workout: StructuredWorkoutInput,
  ): Promise<ActivityUploadResult> {
    this.calls.push(activity);
    this.workouts.push(workout);
    if (this.nextError !== null) {
      throw this.nextError;
    }
    return this.nextResult;
  }
}

interface Harness {
  app: FastifyInstance;
  store: FakeStore;
  strava: FakeStrava;
  settings: FakeSettings;
}

function harness(overrides: {
  settings?: FakeSettings;
  store?: FakeStore;
  strava?: FakeStrava;
  log?: (record: RequestLog) => void;
} = {}): Harness {
  const settings = overrides.settings ?? new FakeSettings();
  const store = overrides.store ?? new FakeStore();
  const strava = overrides.strava ?? new FakeStrava();
  const appOptions = {
    settings,
    store,
    strava,
    log: overrides.log ?? (() => undefined),
  } satisfies CreateAppOptions;
  const app = createApp(appOptions);
  return { app, store, strava, settings };
}

function post(
  app: FastifyInstance,
  options: {
    pathToken?: string;
    key?: string;
    payload?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const pathToken = options.pathToken ?? "correct-token";
  const key = options.key ?? "correct-key";
  return app.inject({
    method: "POST",
    url: `/ingest/${pathToken}`,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-ingest-key": key,
      ...options.headers,
    },
    payload: options.payload ?? "",
  });
}

describe("ingest authentication", () => {
  it("returns 404 with an empty body for a wrong X-Ingest-Key", async () => {
    const { app, store, strava } = harness();
    const response = await post(app, {
      key: "wrong-key",
      payload: VALID_SHARE_TEXT,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
    expect(store.received).toHaveLength(0);
    expect(strava.calls).toHaveLength(0);
  }, 30_000);

  it("returns 404 with an empty body for a wrong path token", async () => {
    const { app, store, strava } = harness();
    const response = await post(app, {
      pathToken: "wrong-token",
      payload: VALID_SHARE_TEXT,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
    expect(store.received).toHaveLength(0);
    expect(strava.calls).toHaveLength(0);
  });
});

describe("ingest processing order", () => {
  it("rejects a body larger than 64 KiB with 413 and writes nothing to Firestore", async () => {
    const { app, store, strava } = harness();
    const response = await post(app, {
      payload: "x".repeat(65_537),
    });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe("payload too large");
    expect(store.received).toHaveLength(0);
    expect(strava.calls).toHaveLength(0);
  });

  it("creates exactly one Strava activity when the same payload is shared twice", async () => {
    const { app, store, strava } = harness();

    const first = await post(app, { payload: VALID_SHARE_TEXT });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatch(/^posted: /);

    const second = await post(app, { payload: VALID_SHARE_TEXT });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatch(/^already posted: /);

    expect(strava.calls).toHaveLength(1);
    expect(store.received).toHaveLength(1);
  });

  it("creates exactly one Strava activity for two shares of the same workout with different slugs", async () => {
    const { app, store, strava } = harness();

    const first = await post(app, {
      payload: shareTextWithSlug("first-slug"),
    });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatch(/^posted: /);

    const second = await post(app, {
      payload: shareTextWithSlug("second-slug"),
    });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatch(/^already posted: /);

    expect(strava.calls).toHaveLength(1);
    expect(store.received).toHaveLength(1);
  });

  it("returns 400 for an unparseable body and persists its raw_text", async () => {
    const { app, store, strava } = harness();
    const raw = "this is not a Strong workout";

    const response = await post(app, { payload: raw });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe("not a Strong workout");
    expect(strava.calls).toHaveLength(0);

    expect(store.received).toHaveLength(1);
    expect(store.received[0]?.raw_text).toBe(raw);
    expect(store.received[0]?.parsed).toBeNull();
    expect(store.docs.get(store.received[0]?.dedupe_key ?? "")?.raw_text).toBe(raw);
  });

  it("returns 400 for a parsed workout with no sets and never calls Strava", async () => {
    const { app, store, strava } = harness();
    const raw =
      "Deadlift day\n" +
      "Wednesday, September 9, 2026 at 6:43 AM\n\n" +
      "Deadlift (Barbell)\n";

    const response = await post(app, { payload: raw });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe("no sets to upload");
    expect(strava.calls).toHaveLength(0);

    // Constraint 6: raw_text survives the rejection so a fixed parser can re-parse.
    expect(store.received).toHaveLength(1);
    expect(store.received[0]?.raw_text).toBe(raw);
    expect(store.docs.has("strong:k3m8q2xz")).toBe(false);
  });

  it("posts deterministic activity text containing real workout numbers", async () => {
    const { app, strava } = harness();

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(200);
    expect(strava.calls).toHaveLength(1);

    const call = strava.calls[0];
    expect(call?.name).toBe("Deadlift day");
    expect(call?.description).toContain("Deadlift");
    expect(call?.description).toContain("315 lb x 4");
    expect(call?.description).toContain("3780 total volume");
    // The upload carries the wall clock as UTC plus an offset, not a naive local string.
    expect(strava.workouts[0]?.start_time_utc).toBe("2026-09-09T11:43:00Z");
    expect(strava.workouts[0]?.utc_offset).toBe(-18_000);
    // Frozen clock is one hour after the fixture's local start time, so this
    // pins the received-minus-started branch of `elapsedSeconds`.
    expect(call?.elapsed_time).toBe(3_600);
  });

  it("maps a Strava 429 to 502 with status failed and no partial state", async () => {
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError({
      status: 429,
      reason: "Strava rate limit exceeded.",
      usage: null,
    });
    const { app, store } = harness({ strava });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(502);
    expect(response.body).toContain("strava rejected:");
    expect(response.body).toContain("rate limit");

    expect(store.results).toHaveLength(1);
    expect(store.results[0]?.result.status).toBe("failed");
    expect(store.results[0]?.result.strava).toBeNull();
    expect(store.results[0]?.result.error).toContain("rate limit");

    const doc = store.docs.get("strong:k3m8q2xz");
    expect(doc?.status).toBe("failed");
    expect(doc?.strava).toBeNull();
  });

  it("retries a failed Strava post without replacing its idempotency record", async () => {
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError({
      status: 429,
      reason: "Strava rate limit exceeded.",
      usage: null,
      fault: "Rate Limit Exceeded",
      stage: "structured_upload",
    });
    const { app, store } = harness({ strava });

    const first = await post(app, { payload: VALID_SHARE_TEXT });
    expect(first.statusCode).toBe(502);
    expect(store.docs.get("strong:k3m8q2xz")?.status).toBe("failed");

    strava.nextError = null;
    const retry = await post(app, { payload: VALID_SHARE_TEXT });

    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatch(/^posted: /);
    expect(strava.calls).toHaveLength(2);
    expect(store.received).toHaveLength(1);
    expect(store.results).toHaveLength(2);
    expect(store.docs.get("strong:k3m8q2xz")?.status).toBe("posted");
    expect(store.docs.get("strong:k3m8q2xz")?.attempts).toBe(2);
  });
});

describe("MVP scope", () => {
  it("performs no model/provider call and requires no model credential", async () => {
    const ingestSource = [
      readFileSync(new URL("../app/main.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../app/activity_text.ts", import.meta.url), "utf8"),
    ].join("\n");

    expect(ingestSource).not.toMatch(
      /\b(?:openai|anthropic|gemini|claude|cohere|vertex|gpt|model_provider|model_credential|api_key)\b/i,
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { app, strava } = harness();
      const response = await post(app, { payload: VALID_SHARE_TEXT });

      expect(response.statusCode).toBe(200);
      expect(strava.calls).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function onlyRecord(records: RequestLog[]): RequestLog {
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) {
    throw new Error("expected one request log record");
  }
  return record;
}

class FailingLookupStore extends FakeStore {
  override async findExisting(): Promise<StoredWorkout | null> {
    throw new Error("firestore unavailable");
  }
}

describe("request logging", () => {
  it("logs the payload and the response status for a posted workout", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(200);
    expect(onlyRecord(records)).toEqual({
      status: 200,
      raw_text: VALID_SHARE_TEXT,
    });
  });

  it("logs the payload unconditionally: no setting suppresses it for a non-404", async () => {
    const records: RequestLog[] = [];
    const settings = new FakeSettings("correct-key", "correct-token");
    const { app } = harness({ settings, log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(200);
    expect(onlyRecord(records)).toEqual({
      status: 200,
      raw_text: VALID_SHARE_TEXT,
    });
  });

  it("logs the shared text rather than the JSON envelope that carried it", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, {
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: VALID_SHARE_TEXT }),
    });

    expect(response.statusCode).toBe(200);
    expect(onlyRecord(records)).toEqual({
      status: 200,
      raw_text: VALID_SHARE_TEXT,
    });
  });

  it("logs one line per share, so a repeated share is visible as a second 200", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    await post(app, { payload: VALID_SHARE_TEXT });
    const second = await post(app, { payload: VALID_SHARE_TEXT });

    expect(second.statusCode).toBe(200);
    expect(second.body).toMatch(/^already posted: /);
    expect(records).toEqual([
      { status: 200, raw_text: VALID_SHARE_TEXT },
      { status: 200, raw_text: VALID_SHARE_TEXT },
    ]);
  });

  it("logs the payload of an unparseable body, which is the point of logging it", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });
    const raw = "some unrecognised set format 3x5 @ 225";

    const response = await post(app, { payload: raw });

    expect(response.statusCode).toBe(400);
    expect(onlyRecord(records)).toEqual({ status: 400, raw_text: raw });
  });

  it("logs a 413 for a body over the cap", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, { payload: "x".repeat(65_537) });

    expect(response.statusCode).toBe(413);
    expect(onlyRecord(records)).toEqual({ status: 413 });
  });

  it("logs a 413 when the cap is hit while reading the body", async () => {
    // A streamed body carries no content-length, so the precheck cannot fire and
    // Fastify's own limit raises FST_ERR_CTP_BODY_TOO_LARGE instead.
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await app.inject({
      method: "POST",
      url: "/ingest/correct-token",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-ingest-key": "correct-key",
      },
      payload: Readable.from([Buffer.from("x".repeat(65_537))]),
    });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe("payload too large");
    expect(onlyRecord(records)).toEqual({ status: 413 });
  });

  it("logs a 502 and the payload when Strava rejects the post", async () => {
    const records: RequestLog[] = [];
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError({
      status: 401,
      reason: "provider fault text that belongs in Firestore, not in the log record",
      usage: null,
      fault: "provider fault text that belongs in Firestore, not in the log record",
      stage: "structured_upload",
    });
    const { app, store } = harness({ strava, log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(502);
    const record = onlyRecord(records);
    expect(record).toEqual({ status: 502, raw_text: VALID_SHARE_TEXT });
    expect(JSON.stringify(record)).not.toContain("provider fault text");
    // The fault text is still recoverable, on the durable copy Firestore keeps.
    expect(store.results[0]?.result.error).toContain("provider fault text");
  });

  it("logs a 500 when Firestore is unavailable, and says nothing more in the body", async () => {
    const records: RequestLog[] = [];
    const { app, strava } = harness({
      store: new FailingLookupStore(),
      log: (r) => records.push(r),
    });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe("internal error");
    expect(onlyRecord(records)).toEqual({ status: 500, raw_text: VALID_SHARE_TEXT });
    expect(strava.calls).toHaveLength(0);
  });

  it("logs a bare status counter for an auth failure (constraint 3)", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, { key: "wrong-key", payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(onlyRecord(records))).toBe('{"status":404}');
  });

  it("logs nothing for a health check", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(records).toHaveLength(0);
  });

  it("never logs a secret, even though the payload is always logged (constraint 7)", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    await post(app, { payload: VALID_SHARE_TEXT });
    const wrongKey = await post(app, { key: "leak-me-key", payload: VALID_SHARE_TEXT });

    expect(wrongKey.statusCode).toBe(404);
    const serialised = JSON.stringify(records);
    expect(serialised).not.toContain("correct-key");
    expect(serialised).not.toContain("correct-token");
    expect(serialised).not.toContain("leak-me-key");
  });
});
