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
  type WorkoutStoreLike,
} from "../app/main.js";
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
} = {}): Harness {
  const settings = overrides.settings ?? new FakeSettings();
  const store = overrides.store ?? new FakeStore();
  const strava = overrides.strava ?? new FakeStrava();
  const app = createApp({
    settings,
    store,
    strava,
    now: () => new Date("2026-09-09T07:43:00Z"),
    log: () => undefined,
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
