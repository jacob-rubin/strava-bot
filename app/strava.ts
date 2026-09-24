import { resolveExerciseType } from "./exercises/exercise_type.js";
import type { ExerciseSummary, WorkoutSet } from "./models.js";

const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";
const STRAVA_UPLOADS_URL = "https://www.strava.com/api/v3/uploads";
const REFRESH_THRESHOLD_MS = 300_000;
const UPLOAD_POLL_INTERVAL_MS = 1_000;
const UPLOAD_POLL_TIMEOUT_MS = 30_000;
const POUNDS_TO_KILOGRAMS = 0.45359237;

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
    body?: string | FormData;
  },
) => Promise<StravaResponseLike>;

export interface StravaSettings {
  getStravaClientId(): Promise<string>;
  getStravaClientSecret(): Promise<string>;
  getStravaRefreshToken(): Promise<string>;
  addStravaRefreshTokenVersion(value: string): Promise<void>;
  /** Re-reads a refresh token from its source, bypassing any cache. */
  reloadStravaRefreshToken?(): Promise<string>;
}

export interface ActivityUploadInput {
  name: string;
  description: string;
  elapsed_time: number;
}

/** The poll only returns on a non-null activity_id, so neither field can be absent. */
export interface ActivityUploadResult {
  id: string;
  url: string;
  upload_id: string;
}

export interface StructuredWorkoutInput {
  start_time_utc: string;
  utc_offset: number;
  exercises: ExerciseSummary[];
}

export interface StravaUsage {
  rateLimitLimit: string;
  rateLimitUsage: string;
  readRateLimitLimit: string;
  readRateLimitUsage: string;
}

/** A safe operational failure category that excludes Strava response text. */
export type StravaFailureStage = "token_refresh" | "structured_upload";

export interface StravaApiErrorOptions {
  readonly status: number;
  readonly reason: string;
  readonly usage: StravaUsage | null;
  readonly fault?: string;
  readonly stage?: StravaFailureStage;
}

export class StravaApiError extends Error {
  readonly status: number;
  readonly usage: StravaUsage | null;
  readonly fault?: string;
  readonly stage?: StravaFailureStage;

  constructor({ status, reason, usage, fault, stage }: StravaApiErrorOptions) {
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
  sleep?: (ms: number) => Promise<void>;
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
  const record = objectRecord(body);
  if (record !== null) {
    if (typeof record.message === "string" && record.message !== "") {
      return record.message;
    }
    if (Array.isArray(record.errors)) {
      const message = record.errors
        .map((entry) => {
          if (
            objectRecord(entry)?.message !== undefined
          ) {
            const value = objectRecord(entry)?.message;
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

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function addSeconds(isoUtc: string, seconds: number): string {
  const startMs = Date.parse(isoUtc);
  if (!Number.isFinite(startMs)) {
    throw new Error("Structured upload requires a valid UTC start time.");
  }
  return new Date(startMs + seconds * 1_000).toISOString();
}

function uploadWeight(set: WorkoutSet): number | undefined {
  if (set.weight === null || set.unit === null) {
    return undefined;
  }
  const kilograms =
    set.unit === "lb" ? set.weight * POUNDS_TO_KILOGRAMS : set.weight;
  return Math.round(kilograms * 1_000) / 1_000;
}

function structuredSetPayload(
  exercise: ExerciseSummary,
  set: WorkoutSet,
  startTimeUtc: string,
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {
    exercise_type: resolveExerciseType(exercise.name, exercise.equipment)
      .exercise_type,
    start_time: startTimeUtc,
  };
  const weight = uploadWeight(set);
  if (weight !== undefined) {
    payload.weight = weight;
  }
  if (set.reps !== null) {
    payload.repetitions = set.reps;
  }
  if (set.duration_s !== null) {
    payload.duration = set.duration_s;
  }
  return payload;
}

function exerciseLabel(exercise: ExerciseSummary): string {
  return exercise.equipment === null
    ? exercise.name
    : exercise.name + " (" + exercise.equipment + ")";
}

/** Constraint 7: a Strong exercise name is the owner's own input, never a credential. */
function logUnmappedExercises(
  log: (line: string) => void,
  exercises: readonly ExerciseSummary[],
): void {
  const unmapped = new Set<string>();
  for (const exercise of exercises) {
    if (!resolveExerciseType(exercise.name, exercise.equipment).mapped) {
      unmapped.add(exerciseLabel(exercise));
    }
  }
  if (unmapped.size === 0) {
    return;
  }
  log(
    'strava structured-upload unmapped-exercises="' +
      [...unmapped].join("|") +
      '"',
  );
}

/** Strava requires source-ordered set times, monotonic and in range. */
function buildStructuredFile(
  activity: ActivityUploadInput,
  workout: StructuredWorkoutInput,
  log: (line: string) => void,
): string {
  if (!Number.isFinite(activity.elapsed_time) || activity.elapsed_time <= 0) {
    throw new Error("Structured upload requires a positive elapsed_time.");
  }
  if (!Number.isFinite(workout.utc_offset)) {
    throw new Error("Structured upload requires a valid utc_offset.");
  }
  const startMs = Date.parse(workout.start_time_utc);
  if (!Number.isFinite(startMs)) {
    throw new Error("Structured upload requires a valid UTC start time.");
  }

  const sets = workout.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({ exercise, set })),
  );
  if (sets.length === 0) {
    throw new Error("Structured upload requires at least one set.");
  }

  logUnmappedExercises(
    log,
    sets.map(({ exercise }) => exercise),
  );

  return JSON.stringify({
    version: "1.0",
    start_time: workout.start_time_utc,
    utc_offset: workout.utc_offset,
    elapsed_time: activity.elapsed_time,
    sets: sets.map(({ exercise, set }, index) =>
      structuredSetPayload(
        exercise,
        set,
        addSeconds(
          workout.start_time_utc,
          Math.floor((index * activity.elapsed_time) / sets.length),
        ),
      ),
    ),
  });
}

function buildStructuredForm(
  activity: ActivityUploadInput,
  workout: StructuredWorkoutInput,
  log: (line: string) => void,
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buildStructuredFile(activity, workout, log)], {
      type: "application/json",
    }),
    "workout.json",
  );
  form.append("data_type", "json");
  form.append("name", activity.name);
  form.append("description", activity.description);
  form.append("sport_type", "WeightTraining");
  return form;
}

function extractUploadId(body: unknown): string | null {
  const record = objectRecord(body);
  if (record === null) {
    return null;
  }
  const id = record.id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }
  if (typeof id === "string" && id !== "") {
    return id;
  }
  return null;
}

function extractActivityId(body: unknown): string | null {
  const record = objectRecord(body);
  if (record === null) {
    return null;
  }
  const id = record.activity_id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }
  if (typeof id === "string" && id !== "") {
    return id;
  }
  return null;
}

function extractUploadError(body: unknown): string | null {
  const record = objectRecord(body);
  if (record === null) {
    return null;
  }
  const error = record.error;
  return typeof error === "string" && error !== "" ? error : null;
}

export class StravaClient {
  readonly #settings: StravaSettings;
  readonly #fetch: StravaFetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #log: (line: string) => void;
  #token: TokenSnapshot | undefined;
  #refreshToken: string | undefined;

  constructor(options: StravaClientOptions) {
    this.#settings = options.settings;
    this.#fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#now = options.now ?? Date.now;
    this.#sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  async getAccessToken(
    options: { force?: boolean; reloadRefreshToken?: boolean } = {},
  ): Promise<string> {
    if (!options.force && this.#token !== undefined) {
      const remaining = this.#token.expiresAt - this.#now();
      if (remaining > REFRESH_THRESHOLD_MS) {
        return this.#token.accessToken;
      }
    }

    await this.refreshAccessToken({
      ...(options.reloadRefreshToken === true
        ? { reloadRefreshToken: true }
        : {}),
    });
    if (this.#token === undefined) {
      throw new Error("Token refresh did not produce an access token.");
    }
    return this.#token.accessToken;
  }

  async refreshAccessToken(
    options: { reloadRefreshToken?: boolean } = {},
  ): Promise<void> {
    const refreshToken = await this.#loadRefreshToken(
      options.reloadRefreshToken === true,
    );
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
      throw new StravaApiError({
        status: response.status,
        reason: "Strava token refresh failed: " + reason,
        usage: usageFrom(response.headers),
        fault: reason,
        stage: "token_refresh",
      });
    }

    const body = objectRecord(await response.json().catch(() => null));
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
      throw new StravaApiError({
        status: response.status,
        reason: "Strava token refresh response was missing required fields.",
        usage: usageFrom(response.headers),
        stage: "token_refresh",
      });
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

  /** Reloading bypasses the local copy so a superseded token can recover. */
  async #loadRefreshToken(reload: boolean): Promise<string> {
    if (!reload) {
      return this.#refreshToken ?? (await this.#settings.getStravaRefreshToken());
    }
    this.#refreshToken = undefined;
    const reloaded = this.#settings.reloadStravaRefreshToken;
    const value =
      reloaded !== undefined
        ? await reloaded.call(this.#settings)
        : await this.#settings.getStravaRefreshToken();
    return value;
  }

  async uploadActivity(
    activity: ActivityUploadInput,
    workout: StructuredWorkoutInput,
  ): Promise<ActivityUploadResult> {
    const form = buildStructuredForm(activity, workout, this.#log);
    const send = async (): Promise<StravaResponseLike> => {
      const accessToken = await this.getAccessToken();
      return this.#postForm(
        STRAVA_UPLOADS_URL,
        form,
        "upload-structured",
        accessToken,
      );
    };

    const response = await this.#sendWithTokenRefresh(send, "upload-structured");

    if (response.status === 429) {
      const usage = usageFrom(response.headers);
      logUsageLine(this.#log, "upload-structured", response.status, usage);
      throw new StravaApiError({
        status: 429,
        reason: "Strava rate limit exceeded.",
        usage,
        fault: "Rate Limit Exceeded",
        stage: "structured_upload",
      });
    }

    if (!isSuccess(response.status)) {
      const usage = usageFrom(response.headers);
      const reason = parseFaultReason(
        await response.json().catch(() => null),
        response.status,
      );
      logUsageLine(this.#log, "upload-structured", response.status, usage);
      throw new StravaApiError({
        status: response.status,
        reason,
        usage,
        fault: reason,
        stage: "structured_upload",
      });
    }

    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, "upload-structured", response.status, usage);
    const body = await response.json().catch(() => null);
    const uploadId = extractUploadId(body);
    if (uploadId === null) {
      throw new StravaApiError({
        status: response.status,
        reason: "Strava structured upload response was missing an upload id.",
        usage,
        stage: "structured_upload",
      });
    }

    return this.#pollUpload(uploadId);
  }

  async #pollUpload(uploadId: string): Promise<ActivityUploadResult> {
    const deadline = this.#now() + UPLOAD_POLL_TIMEOUT_MS;
    return this.#pollUploadAttempt(uploadId, deadline, false);
  }

  async #pollUploadAttempt(
    uploadId: string,
    deadline: number,
    refreshedAfterUnauthorized: boolean,
  ): Promise<ActivityUploadResult> {
    const accessToken = await this.getAccessToken();
    const response = await this.#get(
      STRAVA_UPLOADS_URL + "/" + uploadId,
      "upload-poll",
      accessToken,
    );

    if (response.status === 401 && !refreshedAfterUnauthorized) {
      const usage = usageFrom(response.headers);
      this.#log(
        "strava upload-poll status=401 refresh-once=true" +
          " ratelimit=" + usage.rateLimitUsage +
          " read_ratelimit=" + usage.readRateLimitUsage,
      );
      await this.getAccessToken({ force: true, reloadRefreshToken: true });
      return this.#pollUploadAttempt(uploadId, deadline, true);
    }

    const usage = usageFrom(response.headers);
    if (response.status === 429) {
      logUsageLine(this.#log, "upload-poll", response.status, usage);
      throw new StravaApiError({
        status: 429,
        reason: "Strava rate limit exceeded.",
        usage,
        fault: "Rate Limit Exceeded",
        stage: "structured_upload",
      });
    }
    if (!isSuccess(response.status)) {
      const reason = parseFaultReason(
        await response.json().catch(() => null),
        response.status,
      );
      logUsageLine(this.#log, "upload-poll", response.status, usage);
      throw new StravaApiError({
        status: response.status,
        reason,
        usage,
        fault: reason,
        stage: "structured_upload",
      });
    }

    const body = await response.json().catch(() => null);
    if (extractUploadError(body) !== null) {
      throw new StravaApiError({
        status: response.status,
        reason: "Strava structured upload processing failed.",
        usage,
        stage: "structured_upload",
      });
    }

    const activityId = extractActivityId(body);
    if (activityId !== null) {
      return {
        id: activityId,
        url: activityUrl(activityId),
        upload_id: uploadId,
      };
    }

    if (this.#now() >= deadline) {
      throw new Error("Strava structured upload timed out after 30 seconds.");
    }
    await this.#sleep(UPLOAD_POLL_INTERVAL_MS);
    return this.#pollUploadAttempt(uploadId, deadline, refreshedAfterUnauthorized);
  }

  async #sendWithTokenRefresh(
    send: () => Promise<StravaResponseLike>,
    kind: string,
  ): Promise<StravaResponseLike> {
    const response = await send();
    if (response.status !== 401) {
      return response;
    }

    const usage = usageFrom(response.headers);
    this.#log(
      "strava " + kind + " status=401 refresh-once=true" +
        " ratelimit=" + usage.rateLimitUsage +
        " read_ratelimit=" + usage.readRateLimitUsage,
    );
    await this.getAccessToken({ force: true, reloadRefreshToken: true });
    return send();
  }

  async #post(
    url: string,
    body: Record<string, string | number>,
    kind: string,
    accessToken?: string,
  ): Promise<StravaResponseLike> {
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(body),
    });
    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, kind, response.status, usage);
    return response;
  }

  async #postForm(
    url: string,
    body: FormData,
    kind: string,
    accessToken: string,
  ): Promise<StravaResponseLike> {
    const response = await this.#fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + accessToken },
      body,
    });
    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, kind, response.status, usage);
    return response;
  }

  async #get(
    url: string,
    kind: string,
    accessToken: string,
  ): Promise<StravaResponseLike> {
    const response = await this.#fetch(url, {
      method: "GET",
      headers: { authorization: "Bearer " + accessToken },
    });
    const usage = usageFrom(response.headers);
    logUsageLine(this.#log, kind, response.status, usage);
    return response;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}
