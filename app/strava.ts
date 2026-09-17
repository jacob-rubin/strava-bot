const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/activities";
const REFRESH_THRESHOLD_MS = 300_000;

export interface StravaResponseLike {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
}

export type StravaFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<StravaResponseLike>;

export interface StravaSettings {
  getStravaClientId(): Promise<string>;
  getStravaClientSecret(): Promise<string>;
  getStravaRefreshToken(): Promise<string>;
  addStravaRefreshTokenVersion(value: string): Promise<void>;
}

export interface CreateActivityInput {
  name: string;
  description?: string;
  start_date_local: string;
  elapsed_time: number;
  trainer?: number;
  commute?: number;
}

export interface CreateActivityResult {
  id: string | null;
  url: string | null;
}

export interface StravaUsage {
  rateLimitLimit: string;
  rateLimitUsage: string;
  readRateLimitLimit: string;
  readRateLimitUsage: string;
}

/**
 * A safe operational category for a rejected Strava request.  This is kept
 * separate from Strava's response text so request logs can distinguish a
 * refresh failure from an activity rejection without retaining that text.
 */
export type StravaFailureStage = "token_refresh" | "create_activity";

export class StravaApiError extends Error {
  readonly status: number;
  readonly usage: StravaUsage | null;
  readonly fault?: string;
  readonly stage?: StravaFailureStage;

  constructor(
    status: number,
    reason: string,
    usage: StravaUsage | null,
    fault?: string,
    stage?: StravaFailureStage,
  ) {
    super(reason);
    this.name = "StravaApiError";
    this.status = status;
    this.usage = usage;
    if (fault !== undefined) {
      this.fault = fault;
    }
    if (stage !== undefined) {
      this.stage = stage;
    }
  }
}

export interface StravaClientOptions {
  settings: StravaSettings;
  fetch?: StravaFetch;
  now?: () => number;
  log?: (line: string) => void;
}

interface TokenSnapshot {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function activityUrl(id: string): string {
  return "https://www.strava.com/activities/" + id;
}

function usageFrom(headers: StravaResponseLike["headers"]): StravaUsage {
  return {
    rateLimitLimit: headers.get("X-RateLimit-Limit") ?? "",
    rateLimitUsage: headers.get("X-RateLimit-Usage") ?? "",
    readRateLimitLimit: headers.get("X-ReadRateLimit-Limit") ?? "",
    readRateLimitUsage: headers.get("X-ReadRateLimit-Usage") ?? "",
  };
}

function logUsageLine(
  log: (line: string) => void,
  kind: string,
  status: number,
  usage: StravaUsage,
): void {
  log(
    "strava " + kind + " status=" + status +
      " ratelimit=" + usage.rateLimitUsage +
      " read_ratelimit=" + usage.readRateLimitUsage +
      " ratelimit_limit=" + usage.rateLimitLimit +
      " read_ratelimit_limit=" + usage.readRateLimitLimit,
  );
}

function parseFaultReason(body: unknown, status: number): string {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message !== "") {
      return record.message;
    }
    if (Array.isArray(record.errors)) {
      const message = record.errors
        .map((entry) => {
          if (
            entry !== null &&
            typeof entry === "object" &&
            (entry as Record<string, unknown>).message !== undefined
          ) {
            const value = (entry as Record<string, unknown>).message;
            if (typeof value === "string") {
              return value;
            }
          }
          return null;
        })
        .filter((value): value is string => value !== null)
        .join("; ");
      if (message !== "") {
        return message;
      }
    }
  }
  return "Strava request failed with status " + status;
}

export class StravaClient {
  readonly #settings: StravaSettings;
  readonly #fetch: StravaFetch;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  #token: TokenSnapshot | undefined;
  #refreshToken: string | undefined;

  constructor(options: StravaClientOptions) {
    this.#settings = options.settings;
    this.#fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  async getAccessToken(options: { force?: boolean } = {}): Promise<string> {
    if (!options.force && this.#token !== undefined) {
      const remaining = this.#token.expiresAt - this.#now();
      if (remaining > REFRESH_THRESHOLD_MS) {
        return this.#token.accessToken;
      }
    }

    await this.refreshAccessToken();
    if (this.#token === undefined) {
      throw new Error("Token refresh did not produce an access token.");
    }
    return this.#token.accessToken;
  }

  async refreshAccessToken(): Promise<void> {
    const refreshToken =
      this.#refreshToken ?? (await this.#settings.getStravaRefreshToken());
    const [clientId, clientSecret] = await Promise.all([
      this.#settings.getStravaClientId(),
      this.#settings.getStravaClientSecret(),
    ]);

    const response = await this.#post(
      STRAVA_OAUTH_TOKEN_URL,
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      "token-refresh",
    );

    if (!isSuccess(response.status)) {
      const reason = parseFaultReason(
        await response.json().catch(() => null),
        response.status,
      );
      throw new StravaApiError(
        response.status,
        "Strava token refresh failed: " + reason,
        usageFrom(response.headers),
        reason,
        "token_refresh",
      );
    }

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const accessToken =
      body !== null && typeof body.access_token === "string"
        ? body.access_token
        : "";
    const expiresAtRaw =
      body !== null && typeof body.expires_at === "number"
        ? body.expires_at
        : NaN;
    const rotatedRefreshToken =
      body !== null && typeof body.refresh_token === "string"
        ? body.refresh_token
        : "";

    if (accessToken === "" || !Number.isFinite(expiresAtRaw)) {
      throw new StravaApiError(
        response.status,
        "Strava token refresh response was missing required fields.",
        usageFrom(response.headers),
        undefined,
        "token_refresh",
      );
    }

    if (
      rotatedRefreshToken !== "" &&
      rotatedRefreshToken !== refreshToken
    ) {
      await this.#settings.addStravaRefreshTokenVersion(rotatedRefreshToken);
      this.#refreshToken = rotatedRefreshToken;
    }

    this.#token = {
      accessToken,
      refreshToken: rotatedRefreshToken || refreshToken,
      expiresAt: expiresAtRaw * 1000,
    };
  }

  async createActivity(
    activity: CreateActivityInput,
  ): Promise<CreateActivityResult> {
    const send = async (): Promise<StravaResponseLike> => {
      const accessToken = await this.getAccessToken();
      const body: Record<string, string | number> = {
        name: activity.name,
        sport_type: "WeightTraining",
        type: "WeightTraining",
        start_date_local: activity.start_date_local,
        elapsed_time: activity.elapsed_time,
      };
      if (activity.description !== undefined) {
        body.description = activity.description;
      }
      if (activity.trainer !== undefined) {
        body.trainer = activity.trainer;
      }
      if (activity.commute !== undefined) {
        body.commute = activity.commute;
      }
      return this.#post(STRAVA_ACTIVITIES_URL, body, "create-activity");
    };

    let response = await send();

    if (response.status === 401) {
      const usage = usageFrom(response.headers);
      this.#log(
        "strava create-activity status=401 refresh-once=true" +
          " ratelimit=" + usage.rateLimitUsage +
          " read_ratelimit=" + usage.readRateLimitUsage,
      );
      await this.getAccessToken({ force: true });
      response = await send();
    }

    if (response.status === 429) {
      const usage = usageFrom(response.headers);
      logUsageLine(this.#log, "create-activity", response.status, usage);
      throw new StravaApiError(
        429,
        "Strava rate limit exceeded.",
        usage,
        "Rate Limit Exceeded",
        "create_activity",
      );
    }

    if (!isSuccess(response.status)) {
      const usage = usageFrom(response.headers);
      const reason = parseFaultReason(
        await response.json().catch(() => null),
        response.status,
      );
      logUsageLine(this.#log, "create-activity", response.status, usage);
      throw new StravaApiError(
        response.status,
        reason,
        usage,
        reason,
        "create_activity",
      );
    }

    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, "create-activity", response.status, usage);

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const id =
      body !== null && typeof body.id === "number"
        ? String(body.id)
        : body !== null && typeof body.id === "string"
          ? body.id
          : null;

    if (id !== null) {
      return { id, url: activityUrl(id) };
    }

    const location = response.headers.get("location");
    if (location !== null && location !== "") {
      const match = /\/activities\/(\d+)\s*$/.exec(location);
      if (match?.[1] !== undefined) {
        const locationId = match[1];
        return { id: locationId, url: activityUrl(locationId) };
      }
    }

    return { id: null, url: null };
  }

  async #post(
    url: string,
    body: Record<string, string | number>,
    kind: string,
  ): Promise<StravaResponseLike> {
    const response = await this.#fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, kind, response.status, usage);
    return response;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

