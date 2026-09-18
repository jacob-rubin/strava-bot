/**
 * T17: ingest acceptance bullets from docs/planning/09-acceptance-criteria.md §12.
 *
 * The route is exercised through Fastify's `app.inject` with Firestore and
 * Strava replaced by in-memory stubs at their module boundaries; the local
 * deterministic formatter is the real implementation, so the complete MVP
 * request path runs with only those two external services.
 */
import { readFileSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  createApp,
  type ActivityClient,
  type IngestSettings,
  type RequestLog,
  type WorkoutStoreLike,
} from "../app/main.js";
import type { HistoryContext } from "../app/models.js";
import type {
  ReceivedWorkout,
  StoredWorkout,
  WorkoutResult,
} from "../app/store.js";
import {
  StravaApiError,
  type CreateActivityInput,
  type CreateActivityResult,
} from "../app/strava.js";

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

class FakeSettings implements IngestSettings {
  readonly localTz = "America/Chicago";
  readonly maxBodyBytes = 65_536;
  readonly elapsedCapS = 14_400;

  constructor(
    readonly ingestKey = "correct-key",
    readonly pathToken = "correct-token",
    readonly debugLogRawText = true,
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
  readonly calls: CreateActivityInput[] = [];
  nextResult: CreateActivityResult = {
    id: "1234567890",
    url: "https://www.strava.com/activities/1234567890",
  };
  nextError: unknown = null;

  async createActivity(
    activity: CreateActivityInput,
  ): Promise<CreateActivityResult> {
    this.calls.push(activity);
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
  const app = createApp({
    settings,
    store,
    strava,
    now: () => new Date("2026-09-09T07:43:00Z"),
    log: overrides.log ?? (() => undefined),
  });
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
    expect(call?.start_date_local).toBe("2026-09-09T06:43:00");
    expect(call?.elapsed_time).toBeGreaterThan(0);
  });

  it("maps a Strava 429 to 502 with status failed and no partial state", async () => {
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError(
      429,
      "Strava rate limit exceeded.",
      null,
    );
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
    strava.nextError = new StravaApiError(
      429,
      "Strava rate limit exceeded.",
      null,
      "Rate Limit Exceeded",
      "create_activity",
    );
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

describe("request logging", () => {
  it("logs raw_text, body_bytes, and content_type when DEBUG_LOG_RAW_TEXT is on", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    expect(record.raw_text).toBe(VALID_SHARE_TEXT);
    expect(record.body_bytes).toBe(Buffer.byteLength(VALID_SHARE_TEXT, "utf8"));
    expect(record.content_type).toBe("text/plain; charset=utf-8");
  });

  it("omits raw_text when DEBUG_LOG_RAW_TEXT is off but keeps the metadata", async () => {
    const records: RequestLog[] = [];
    const settings = new FakeSettings("correct-key", "correct-token", false);
    const { app } = harness({ settings, log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    expect(record.raw_text).toBeUndefined();
    expect(record.body_bytes).toBeGreaterThan(0);
  });

  it("logs raw_text for an unparseable body, which is the point of the flag", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });
    const raw = "some unrecognised set format 3x5 @ 225";

    const response = await post(app, { payload: raw });

    expect(response.statusCode).toBe(400);
    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    expect(record.raw_text).toBe(raw);
  });

  it("logs a safe Strava failure stage without the provider fault text", async () => {
    const records: RequestLog[] = [];
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError(
      400,
      "provider fault text that must stay out of structured categories",
      null,
      "provider fault text that must stay out of structured categories",
      "create_activity",
    );
    const { app } = harness({ strava, log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(502);
    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    expect(record.outcome).toBe("strava_rejected");
    expect(record.strava_failure_stage).toBe("create_activity");
    expect(JSON.stringify(record)).not.toContain("provider fault text");
  });

  it("records the Strava HTTP status so a 401 is diagnosable from logs", async () => {
    const records: RequestLog[] = [];
    const strava = new FakeStrava();
    strava.nextError = new StravaApiError(
      401,
      "Authorization Error",
      null,
      "Authorization Error",
      "create_activity",
    );
    const { app } = harness({ strava, log: (r) => records.push(r) });

    const response = await post(app, { payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(502);
    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    expect(record.strava_status).toBe(401);
    expect(record.strava_failure_stage).toBe("create_activity");
  });

  it("reports Strava latency in seconds, not milliseconds", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    await post(app, { payload: VALID_SHARE_TEXT });

    const record = records[0];
    if (record === undefined) {
      throw new Error("expected one request log record");
    }
    // A local fake resolves in well under a second; the old code multiplied
    // milliseconds by 1000 and reported values in the hundreds.
    expect(record.strava_latency_s).not.toBeNull();
    expect(record.strava_latency_s ?? 0).toBeLessThan(5);
  });

  it("never logs a secret, even with DEBUG_LOG_RAW_TEXT on (constraint 7)", async () => {
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

  it("logs only a bare counter for an auth failure (constraint 3)", async () => {
    const records: RequestLog[] = [];
    const { app } = harness({ log: (r) => records.push(r) });

    const response = await post(app, { key: "wrong-key", payload: VALID_SHARE_TEXT });

    expect(response.statusCode).toBe(404);
    expect(records).toHaveLength(0);
  });
});
