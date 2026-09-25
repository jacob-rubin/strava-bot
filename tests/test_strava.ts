import { describe, expect, it, vi } from "vitest";

import {
  StravaApiError,
  StravaClient,
  type ActivityUploadInput,
  type StravaFetch,
  type StravaResponseLike,
  type StravaSettings,
  type StructuredWorkoutInput,
} from "../app/strava.js";
import type { ExerciseSummary, WeightRepsSet } from "../app/models.js";

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
const UPLOAD_ID = 987;
const ACTIVITY_ID = 456;
const EXTERNAL_ID = "strava-bot-test-upload";

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

function uploadAccepted(): StravaResponseLike {
  return jsonResponse(201, { id: UPLOAD_ID, external_id: EXTERNAL_ID });
}

function uploadReady(): StravaResponseLike {
  return jsonResponse(200, {
    id: UPLOAD_ID,
    status: "Your activity is ready.",
    error: null,
    activity_id: ACTIVITY_ID,
  });
}

function isOauth(url: string): boolean {
  return url.includes("/oauth/token");
}

function isUploadIntake(url: string): boolean {
  return url.endsWith("/uploads");
}

const ACTIVITY_INPUT: ActivityUploadInput = {
  name: "Early Morning Workout",
  description: "4 exercises",
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

function exercise(
  name: string,
  equipment: string | null,
  sets: WeightRepsSet[],
): ExerciseSummary {
  return {
    name,
    equipment,
    top_set: { weight: 315, unit: "lb", reps: 4 },
    total_volume: 2_385,
    total_reps: 9,
    sets,
  };
}

const STRUCTURED_WORKOUT: StructuredWorkoutInput = {
  start_time_utc: "2026-09-09T11:43:00Z",
  utc_offset: -18_000,
  exercises: [
    exercise("Bench Press", "Barbell", [
      weightSet("1", 315, 4),
      weightSet("2", 225, 5),
    ]),
  ],
};

/** A happy-path upload: intake accepts, the first poll is already terminal. */
function readyUploadFetch(accessToken: string): StravaFetch {
  return async (url: string): Promise<StravaResponseLike> => {
    if (isOauth(url)) {
      return oauthResponse(accessToken, "rt-old", BASE_TIME / 1000 + 3600);
    }
    return isUploadIntake(url) ? uploadAccepted() : uploadReady();
  };
}

describe("StravaClient token caching", () => {
  it("authenticates the upload and its 401 retry with the current bearer token", async () => {
    let refreshCount = 0;
    let intakeCount = 0;
    const fetchMock = vi.fn<StravaFetch>(async (url, init) => {
      if (isOauth(url)) {
        expect(init?.headers?.authorization).toBeUndefined();
        refreshCount += 1;
        return oauthResponse(`token-${refreshCount}`, "rt-old", BASE_TIME / 1000 + 3600);
      }
      expect(init?.headers?.authorization).toBe(`Bearer token-${refreshCount}`);
      if (!isUploadIntake(url)) {
        return uploadReady();
      }
      intakeCount += 1;
      return intakeCount === 1
        ? jsonResponse(401, { message: "Authorization Error" })
        : uploadAccepted();
    });
    const log = vi.fn();
    const client = new StravaClient({
      settings: new FakeSettings(),
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log,
    });

    const result = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("456");
    expect(refreshCount).toBe(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("token-1");
    expect(JSON.stringify(log.mock.calls)).not.toContain("token-2");
  });

  it("reuses a cached access token until fewer than 300s remain", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(readyUploadFetch("token-a"));
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const first = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);
    const second = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(first.url).toBe("https://www.strava.com/activities/456");
    expect(second.url).toBe("https://www.strava.com/activities/456");
    expect(settings.addedVersions).toStrictEqual([]);
    expect(fetchMock.mock.calls.filter(([url]) => isOauth(url))).toHaveLength(1);
  });

  it("refreshes when the cached token drops below the 300s threshold", async () => {
    const settings = new FakeSettings();
    let now = BASE_TIME;
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          // Relative to the frozen clock, so only the clock advance expires it.
          return oauthResponse("token-b", "rt-old", now / 1000 + 600);
        }
        return isUploadIntake(url) ? uploadAccepted() : uploadReady();
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => now,
      log: () => undefined,
    });

    await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);
    now = BASE_TIME + 300_000 + 1;
    await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(fetchMock.mock.calls.filter(([url]) => isOauth(url))).toHaveLength(2);
  });

  it("persists a rotated refresh token exactly once before proceeding", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-c", "rt-new", BASE_TIME / 1000 + 3600);
        }
        return isUploadIntake(url) ? uploadAccepted() : uploadReady();
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(settings.addedVersions).toStrictEqual(["rt-new"]);
    expect(settings.currentRefresh).toBe("rt-new");
  });
});

describe("StravaClient failure mapping", () => {
  it("refreshes once and retries the upload once on a 401, then succeeds", async () => {
    const settings = new FakeSettings();
    const intakeResponses: StravaResponseLike[] = [
      jsonResponse(401, { message: "Authorization Error" }),
      uploadAccepted(),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-d", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (!isUploadIntake(url)) {
          return uploadReady();
        }
        return intakeResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const result = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("456");
    expect(settings.addedVersions).toStrictEqual([]);
    expect(
      fetchMock.mock.calls.filter(([url]) => isUploadIntake(url)),
    ).toHaveLength(2);
  });

  it("re-reads the refresh token on a 401 instead of reusing the cached one", async () => {
    const settings = new FakeSettings();
    const intakeResponses: StravaResponseLike[] = [
      jsonResponse(401, { message: "Authorization Error" }),
      uploadAccepted(),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-f", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (!isUploadIntake(url)) {
          return uploadReady();
        }
        return intakeResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    // Without the bypass the retry would reuse the same cached token, so a
    // stale value could only ever fail again.
    expect(settings.reloadCount).toBe(1);
  });

  it("picks up a refresh token another instance rotated, without a restart", async () => {
    const settings = new FakeSettings();
    const sentRefreshTokens: string[] = [];
    const intakeResponses: StravaResponseLike[] = [
      uploadAccepted(),
      jsonResponse(401, { message: "Authorization Error" }),
      uploadAccepted(),
    ];
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string, init): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          const requestBody = init?.body;
          if (typeof requestBody !== "string") {
            throw new Error("Expected the token request to use JSON.");
          }
          const body = JSON.parse(requestBody) as { refresh_token?: string };
          sentRefreshTokens.push(body.refresh_token ?? "");
          return oauthResponse("token-g", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (!isUploadIntake(url)) {
          return uploadReady();
        }
        return intakeResponses.shift() ?? jsonResponse(500, {});
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);
    settings.currentRefresh = "rt-rotated-elsewhere";

    const result = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result.id).toBe("456");
    expect(sentRefreshTokens.at(-1)).toBe("rt-rotated-elsewhere");
  });

  it("fails immediately on 429 without retrying and exposes usage", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-e", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(429, { message: "Rate Limit Exceeded" });
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).status).toBe(429);
    expect((error as StravaApiError).stage).toBe("structured_upload");
    expect((error as StravaApiError).usage?.rateLimitUsage).toBe("1,5");
    expect(
      fetchMock.mock.calls.filter(([url]) => isUploadIntake(url)),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/activities"))).toBe(
      false,
    );
  });

  it("maps other 4xx responses to the Strava Fault reason", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-f", "rt-old", BASE_TIME / 1000 + 3600);
        }
        return jsonResponse(400, { message: "bad sport_type" });
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).status).toBe(400);
    expect((error as StravaApiError).stage).toBe("structured_upload");
    expect((error as StravaApiError).fault).toBe("bad sport_type");
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/activities"))).toBe(
      false,
    );
  });

  it("categorizes a rejected token refresh without exposing its fault as a category", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (): Promise<StravaResponseLike> =>
        jsonResponse(400, { message: "refresh token rejected" }),
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).stage).toBe("token_refresh");
  });

  it("fails the request when the upload itself reports a processing error", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-h", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (isUploadIntake(url)) {
          return uploadAccepted();
        }
        return jsonResponse(200, {
          id: UPLOAD_ID,
          status: "There was an error processing your activity.",
          error: "workout.json duplicate of activity 21234316",
          activity_id: null,
        });
      },
    );
    const log = vi.fn();
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).message).toBe(
      "Strava structured upload processing failed.",
    );
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/activities"))).toBe(
      false,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("duplicate of activity");
  });

  it("refuses an intake answer that is an earlier upload's finished record", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-p", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (isUploadIntake(url)) {
          return jsonResponse(201, {
            id: UPLOAD_ID,
            external_id: "workout.json",
            status: "Your activity is ready.",
            error: null,
            activity_id: ACTIVITY_ID,
          });
        }
        return uploadReady();
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StravaApiError);
    expect((error as StravaApiError).stage).toBe("structured_upload");
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes(`/uploads/${UPLOAD_ID}`)),
    ).toBe(false);
  });

  it("times out after 30s of polling rather than falling back", async () => {
    const settings = new FakeSettings();
    let now = BASE_TIME;
    const sleep = vi.fn(async (ms: number): Promise<void> => {
      now += ms;
    });
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-j", "rt-old", now / 1000 + 3_600);
        }
        if (isUploadIntake(url)) {
          return uploadAccepted();
        }
        return jsonResponse(200, {
          id: UPLOAD_ID,
          status: "Your activity is still being processed.",
          error: null,
          activity_id: null,
        });
      },
    );
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => now,
      sleep,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Strava structured upload timed out after 30 seconds.",
    );
    expect(sleep).toHaveBeenCalledTimes(30);
    expect(sleep.mock.calls.every(([ms]) => ms === 1_000)).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes(`/uploads/${UPLOAD_ID}`)),
    ).toHaveLength(31);
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/activities"))).toBe(
      false,
    );
  });
});

describe("StravaClient structured upload payload", () => {
  it("posts the confirmed JSON schema with uniform set times and mapped exercises", async () => {
    const settings = new FakeSettings();
    let uploadForm: FormData | undefined;
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string, init): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-k", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (isUploadIntake(url)) {
          if (!(init?.body instanceof FormData)) {
            throw new Error("Expected multipart structured upload.");
          }
          uploadForm = init.body;
          return uploadAccepted();
        }
        return uploadReady();
      },
    );
    const log = vi.fn();
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      sleep: async () => undefined,
      log,
    });

    const result = await client.uploadActivity(ACTIVITY_INPUT, STRUCTURED_WORKOUT);

    expect(result).toStrictEqual({
      id: "456",
      url: "https://www.strava.com/activities/456",
      upload_id: "987",
    });
    expect(uploadForm?.get("data_type")).toBe("json");
    expect(uploadForm?.get("external_id")).toBe(EXTERNAL_ID);
    expect(uploadForm?.get("name")).toBe("Early Morning Workout");
    expect(uploadForm?.get("description")).toBe("4 exercises");
    expect(uploadForm?.get("sport_type")).toBe("WeightTraining");
    expect(uploadForm?.get("activity_type")).toBeNull();

    const file = uploadForm?.get("file");
    if (file === undefined || file === null || typeof file === "string") {
      throw new Error("Expected the structured upload to include a file.");
    }
    expect(file.name).toBe(EXTERNAL_ID + ".json");
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
    expect(document.sets[0]).toStrictEqual({
      exercise_type: "BARBELL_BENCH_PRESS",
      start_time: "2026-09-09T11:43:00.000Z",
      weight: 142.882,
      repetitions: 4,
    });
    expect(document.sets[0]).not.toHaveProperty("category");
    expect(document.sets[0]).not.toHaveProperty("category_subtype");
    expect(JSON.stringify(log.mock.calls)).not.toContain("unmapped-exercises");
  });

  it("falls back to the generic exercise type and names what it could not map", async () => {
    const settings = new FakeSettings();
    let uploadForm: FormData | undefined;
    const fetchMock = vi.fn<StravaFetch>(
      async (url: string, init): Promise<StravaResponseLike> => {
        if (isOauth(url)) {
          return oauthResponse("token-l", "rt-old", BASE_TIME / 1000 + 3600);
        }
        if (isUploadIntake(url)) {
          if (init?.body instanceof FormData) {
            uploadForm = init.body;
          }
          return uploadAccepted();
        }
        return uploadReady();
      },
    );
    const log = vi.fn();
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log,
    });

    await client.uploadActivity(ACTIVITY_INPUT, {
      ...STRUCTURED_WORKOUT,
      exercises: [
        exercise("Bench Press", "Barbell", [weightSet("1", 315, 4)]),
        exercise("Sandbag Zercher Carry", null, [weightSet("1", 100, 1)]),
        exercise("Sandbag Zercher Carry", null, [weightSet("2", 100, 1)]),
      ],
    });

    const file = uploadForm?.get("file");
    if (file === undefined || file === null || typeof file === "string") {
      throw new Error("Expected the structured upload to include a file.");
    }
    const document = JSON.parse(await file.text()) as {
      sets: Record<string, unknown>[];
    };

    expect(document.sets.map((set) => set.exercise_type)).toStrictEqual([
      "BARBELL_BENCH_PRESS",
      "TOTAL_BODY_GENERIC",
      "TOTAL_BODY_GENERIC",
    ]);
    // Distinct names only, so a repeated exercise does not repeat in the line.
    expect(log).toHaveBeenCalledWith(
      'strava structured-upload unmapped-exercises="Sandbag Zercher Carry"',
    );
  });

  it("refuses to build an upload for a workout with no sets", async () => {
    const settings = new FakeSettings();
    const fetchMock = vi.fn<StravaFetch>(readyUploadFetch("token-m"));
    const client = new StravaClient({
      settings,
      externalId: () => EXTERNAL_ID,
      fetch: fetchMock,
      now: () => BASE_TIME,
      log: () => undefined,
    });

    const error = await client
      .uploadActivity(ACTIVITY_INPUT, {
        ...STRUCTURED_WORKOUT,
        exercises: [exercise("Bench Press", "Barbell", [])],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Structured upload requires at least one set.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
