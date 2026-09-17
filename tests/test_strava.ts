import { describe, expect, it, vi } from "vitest";

import {
  StravaApiError,
  StravaClient,
  type StravaFetch,
  type StravaResponseLike,
  type StravaSettings,
} from "../app/strava.js";

class FakeSettings implements StravaSettings {
  clientId = "12345";
  clientSecret = "client-secret";
  currentRefresh = "rt-old";
  addedVersions: string[] = [];

  async getStravaClientId(): Promise<string> {
    return this.clientId;
  }

  async getStravaClientSecret(): Promise<string> {
    return this.clientSecret;
  }

  async getStravaRefreshToken(): Promise<string> {
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

describe("StravaClient token caching", () => {
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
    const body = JSON.parse(activityCall?.[1]?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(body.type).toBe("WeightTraining");
    expect(body.sport_type).toBe("WeightTraining");
    expect(body.name).toBe("Early Morning Workout");
  });
});


