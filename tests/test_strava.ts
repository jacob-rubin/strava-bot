import { describe, expect, it, vi } from "vitest";

import {
  StravaApiError,
  StravaClient,
  type StravaFetch,
  type StravaResponseLike,
  type StravaSettings,
  type StructuredWorkoutInput,
} from "../app/strava.js";
import type { WeightRepsSet } from "../app/models.js";

class FakeSettings implements StravaSettings {
  clientId = "12345";
  clientSecret = "client-secret";
  currentRefresh = "rt-old";
  addedVersions: string[] = [];
  reloadCount = 0;

  async getStravaClientId(): Promise<string> {
    return this.clientId;
  }

  async getStravaClientSecret(): Promise<string> {
    return this.clientSecret;
  }

  async getStravaRefreshToken(): Promise<string> {
    return this.currentRefresh;
  }

  /**
   * Stands in for the Secret Manager cache bypass. Incrementing the counter is
   * how a test observes that the client re-read the token instead of reusing
   * the copy it already held.
   */
  async reloadStravaRefreshToken(): Promise<string> {
    this.reloadCount += 1;
    return this.currentRefresh;
  }

  async addStravaRefreshTokenVersion(value: string): Promise<void> {
    this.addedVersions.push(value);
    this.currentRefresh = value;
  }
}

const BASE_TIME = 1_890_000_000_000;

function jsonResponse(status: number, body: unknown): StravaResponseLike {
  return {
    status,
    headers: {
      get(name: string): string | null {
        const headers: Record<string, string> = {
          "x-ratelimit-limit": "100,1000",
          "x-ratelimit-usage": "1,5",
          "x-readratelimit-limit": "200,2000",
          "x-readratelimit-usage": "0,0",
        };
        const value = headers[name.toLowerCase()];
        return value === undefined ? null : value;
      },
    },
    async json(): Promise<unknown> {
      return body;
    },
  };
}

function oauthResponse(
  accessToken: string,
  refreshToken: string,
  expiresAtSeconds: number,
): StravaResponseLike {
  return jsonResponse(200, {
    token_type: "Bearer",
    access_token: accessToken,
    expires_at: expiresAtSeconds,
    refresh_token: refreshToken,
  });
}

const ACTIVITY_INPUT = {
  name: "Early Morning Workout",
  description: "4 exercises",
  start_date_local: "2026-09-09T06:43:00",
  elapsed_time: 3600,
};

function weightSet(index: string, weight: number, reps: number): WeightRepsSet {
  return {
    kind: "weight_reps",
    index,
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

const STRUCTURED_WORKOUT: StructuredWorkoutInput = {
  start_time_utc: "2026-09-09T11:43:00Z",
  utc_offset: -18_000,
  exercises: [
    {
      name: "Bench Press",
      equipment: "Barbell",
      top_set: { weight: 315, unit: "lb", reps: 4 },
      total_volume: 2_385,
      total_reps: 9,
      sets: [weightSet("1", 315, 4), weightSet("2", 225, 5)],
    },
  ],
};

describe("StravaClient token caching", () => {
  it("authenticates activity requests and the 401 retry with the current bearer token", async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn<StravaFetch>(async (url, init) => {
      if (url.includes("/oauth/token")) {
        expect(init?.headers?.authorization).toBeUndefined();
        refreshCount += 1;
        return oauthResponse(`token-${refreshCount}`, "rt-old", BASE_TIME / 1000 + 3600);
      }
      expect(init?.headers?.authorization).toBe(`Bearer token-${refreshCount}`);
      return refreshCount === 1
        ? jsonResponse(401, { message: "Authorization Error" })
        : jsonResponse(201, { id: 123 });
    });
    const log = vi.fn();
    const client = new StravaClient({
      settings: new FakeSettings(),
      fetch: fetchMock,
      now: () => BASE_TIME,
      log,
    });
    expect((await client.createActivity(ACTIVITY_INPUT)).id).toBe("123");
    expect(refreshCount).toBe(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("token-1");
    expect(JSON.stringify(log.mock.calls)).not.toContain("token-2");
  });

  it("reuses a cached access token until fewer than 300s remain", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-a", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(201, { id: 123 });
      },
    );
    let now = BASE_TIME;
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => now,
      log: () => undefined,
    });

    const first = await client.createActivity(ACTIVITY_INPUT);
    const second = await client.createActivity(ACTIVITY_INPUT);

    expect(first.url).toBe("https://www.strava.com/activities/123");
    expect(second.url).toBe("https://www.strava.com/activities/123");
    expect(settings.addedVersions).toStrictEqual([]);
    const oauthCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("/oauth/token"),
    );
    expect(oauthCalls).toHaveLength(1);
  });

  it("refreshes when the cached token drops below the 300s threshold", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-b", "rt-old", BASE_TIME / 1000 + 600);
        }
        return jsonResponse(201, { id: 456 });
      },
    );
    let now = BASE_TIME;
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => now,
      log: () => undefined,
    });

    await client.createActivity(ACTIVITY_INPUT);
    now = BASE_TIME + 300_000 + 1;
    await client.createActivity(ACTIVITY_INPUT);

    const oauthCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("/oauth/token"),
    );
    expect(oauthCalls).toHaveLength(2);
  });

  it("persists a rotated refresh token exactly once before proceeding", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-c", "rt-new", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(201, { id: 789 });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.createActivity(ACTIVITY_INPUT);

    expect(settings.addedVersions).toStrictEqual(["rt-new"]);
    expect(settings.currentRefresh).toBe("rt-new");
  });
});

describe("StravaClient failure mapping", () => {
  it("refreshes once and retries once on a 401, then succeeds", async () => {
    const settings = new FakeSettings();
    const activityResponses: StravaResponseLike[] = [
      jsonResponse(401, { message: "Authorization Error" }),
      jsonResponse(201, { id: 321 }),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-d", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return activityResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const result = await client.createActivity(ACTIVITY_INPUT);

    expect(result.id).toBe("321");
    expect(settings.addedVersions).toStrictEqual([]);
    const activityCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("/activities"),
    );
    expect(activityCalls).toHaveLength(2);
  });

  it("re-reads the refresh token on a 401 instead of reusing the cached one", async () => {
    const settings = new FakeSettings();
    const activityResponses: StravaResponseLike[] = [
      jsonResponse(401, { message: "Authorization Error" }),
      jsonResponse(201, { id: 654 }),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-f", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return activityResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.createActivity(ACTIVITY_INPUT);

    // Without the bypass the retry would reuse the same cached token, so a
    // stale value could only ever fail again.
    expect(settings.reloadCount).toBe(1);
  });

  it("picks up a refresh token another instance rotated, without a restart", async () => {
    const settings = new FakeSettings();
    // Simulate a rotation persisted elsewhere: the source of truth has moved on
    // while this client still holds "rt-old".
    const sentRefreshTokens: string[] = [];
    const activityResponses: StravaResponseLike[] = [
      jsonResponse(201, { id: 111 }),
      jsonResponse(401, { message: "Authorization Error" }),
      jsonResponse(201, { id: 222 }),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string, init): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          const requestBody = init?.body;
          if (typeof requestBody !== "string") {
            throw new Error("Expected the token request to use JSON.");
          }
          const body = JSON.parse(requestBody) as {
            refresh_token?: string;
          };
          sentRefreshTokens.push(body.refresh_token ?? "");
          return oauthResponse("token-g", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return activityResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.createActivity(ACTIVITY_INPUT);
    settings.currentRefresh = "rt-rotated-elsewhere";

    const result = await client.createActivity(ACTIVITY_INPUT);

    expect(result.id).toBe("222");
    expect(sentRefreshTokens.at(-1)).toBe("rt-rotated-elsewhere");
  });

  it("fails immediately on 429 without retrying and exposes usage", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-e", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(429, { message: "Rate Limit Exceeded" });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .createActivity(ACTIVITY_INPUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).status).toBe(429);
    expect((error as StravaApiError).stage).toBe("create_activity");
    expect((error as StravaApiError).usage?.rateLimitUsage).toBe("1,5");
    const activityCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("/activities"),
    );
    expect(activityCalls).toHaveLength(1);
  });

  it("maps other 4xx responses to the Strava Fault reason", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-f", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(400, { message: "bad sport_type" });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .createActivity(ACTIVITY_INPUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).status).toBe(400);
    expect((error as StravaApiError).stage).toBe("create_activity");
    expect((error as StravaApiError).fault).toBe("bad sport_type");
  });

  it("categorizes a rejected token refresh without exposing its fault as a category", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (): Promise<StravaResponseLike> =>
        jsonResponse(400, { message: "refresh token rejected" }),
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .createActivity(ACTIVITY_INPUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).stage).toBe("token_refresh");
  });
});

describe("StravaClient create payload", () => {
  it("sends both type and sport_type as WeightTraining", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-g", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(201, { id: 654 });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.createActivity(ACTIVITY_INPUT);

    const activityCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("/activities"),
    );
    const requestBody = activityCall?.[1]?.body;
    if (typeof requestBody !== "string") {
      throw new Error("Expected the primary activity request to use JSON.");
    }
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body.type).toBe("WeightTraining");
    expect(body.sport_type).toBe("WeightTraining");
    expect(body.name).toBe("Early Morning Workout");
  });
});

describe("StravaClient structured upload", () => {
  it("structured flag off means createActivity is the only write call", async () => {
    const settings = new FakeSettings();
    const writeCalls: string[] = [];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-h", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (url.includes("/uploads")) {
          throw new Error("structured upload must stay disabled");
        }
        writeCalls.push(url);
        return jsonResponse(201, { id: 111 });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const result = await client.createActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("111");
    expect(writeCalls).toStrictEqual([
      "https://www.strava.com/api/v3/activities",
    ]);
  });

  it("structured upload error falls back to createActivity in the same request", async () => {
    const settings = new FakeSettings();
    const writeCalls: string[] = [];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-i", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (url.includes("/uploads")) {
          writeCalls.push("upload");
          return jsonResponse(400, { message: "provider upload fault" });
        }
        writeCalls.push("activity");
        return jsonResponse(201, { id: 222 });
      },
    );
    const log = vi.fn();
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log,
      useStructuredUpload: true,
    });

    const result = await client.createActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("222");
    expect(result.method ?? "activities").toBe("activities");
    expect(writeCalls).toStrictEqual(["upload", "activity"]);
    expect(JSON.stringify(log.mock.calls)).toContain(
      "fallback=create-activity",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "provider upload fault",
    );
  });

  it("structured poll loop times out at 30s into the fallback", async () => {
    const settings = new FakeSettings();
    let now = BASE_TIME;
    const sleep = vi.fn(async (ms: number): Promise<void> => {
      now += ms;
    });
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-j", "rt-old", now / 1000 + 3_600);
        }
        if (url.endsWith("/uploads")) {
          return jsonResponse(201, { id: 987 });
        }
        if (url.includes("/uploads/987")) {
          return jsonResponse(200, {
            id: 987,
            status: "processing",
            error: null,
            activity_id: null,
          });
        }
        return jsonResponse(201, { id: 333 });
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => now,
      sleep,
      log: () => undefined,
      useStructuredUpload: true,
    });

    const result = await client.createActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("333");
    expect(sleep).toHaveBeenCalledTimes(30);
    expect(sleep.mock.calls.every(([ms]) => ms === 1_000)).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("/uploads/987")),
    ).toHaveLength(31);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url.endsWith("/activities"),
      ),
    ).toHaveLength(1);
  });

  it("structured upload posts the confirmed JSON schema with uniform set times", async () => {
    const settings = new FakeSettings();
    let uploadForm: FormData | undefined;
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string, init): Promise<StravaResponseLike> => {
        if (url.includes("/oauth/token")) {
          return oauthResponse("token-k", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (url.endsWith("/uploads")) {
          if (!(init?.body instanceof FormData)) {
            throw new Error("Expected multipart structured upload.");
          }
          uploadForm = init.body;
          return jsonResponse(201, { id: 987 });
        }
        if (url.includes("/uploads/987")) {
          return jsonResponse(200, {
            id: 987,
            status: "ready",
            error: null,
            activity_id: 456,
          });
        }
        throw new Error("primary path should not be used");
      },
    );
    const client = new StravaClient({
      settings,
      fetch: fetchMock,
      now: () => BASE_TIME,
      sleep: async () => undefined,
      log: () => undefined,
      useStructuredUpload: true,
    });

    const result = await client.createActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result).toMatchObject({
      id: "456",
      url: "https://www.strava.com/activities/456",
      method: "uploads",
      upload_id: "987",
    });
    expect(uploadForm?.get("data_type")).toBe("json");
    expect(uploadForm?.get("name")).toBe("Early Morning Workout");
    expect(uploadForm?.get("description")).toBe("4 exercises");
    expect(uploadForm?.get("activity_type")).toBe("WeightTraining");

    const file = uploadForm?.get("file");
    if (file === undefined || file === null || typeof file === "string") {
      throw new Error("Expected the structured upload to include a file.");
    }
    const document = JSON.parse(await file.text()) as {
      version: string;
      start_time: string;
      utc_offset: number;
      elapsed_time: number;
      sets: Record<string, unknown>[];
    };

    expect(document.version).toBe("1.0");
    expect(document.start_time).toBe("2026-09-09T11:43:00Z");
    expect(document.utc_offset).toBe(-18_000);
    expect(document.elapsed_time).toBe(3_600);
    expect(document.sets).toHaveLength(2);
    expect(document.sets.map((set) => set.start_time)).toStrictEqual([
      "2026-09-09T11:43:00.000Z",
      "2026-09-09T12:13:00.000Z",
    ]);
    expect(document.sets[0]).toMatchObject({
      exercise_type: "BENCH_PRESS",
      repetitions: 4,
      weight: 142.882,
      category: null,
      category_subtype: null,
    });
  });
});
