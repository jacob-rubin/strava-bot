/**
 * HTTP entrypoint for the Strong-to-Strava ingest path (§5).
 *
 * The route deliberately owns request ordering: authentication and the
 * Content-Length check happen in `onRequest`, before Fastify reads a body;
 * parsing, idempotency, the durable write, local formatting, the Strava call,
 * and the terminal write then happen in that order in the handler.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Firestore, Timestamp } from "@google-cloud/firestore";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { DateTime } from "luxon";

import { formatActivityText } from "./activity_text.js";
import { loadSettings, type Settings } from "./config.js";
import {
  contentHash,
  dedupeKey,
  elapsedSeconds,
  ParseError,
  parseWorkout,
  summarizeWorkout,
} from "./parser.js";
import {
  firestoreWorkouts,
  WorkoutStore,
  type ReceivedWorkout,
  type StoredWorkout,
  type WorkoutResult,
} from "./store.js";
import {
  StravaApiError,
  StravaClient,
  type CreateActivityInput,
  type CreateActivityResult,
  type StravaSettings,
  type StravaUsage,
} from "./strava.js";

const MAX_RESPONSE_LENGTH = 200;

type IngestParams = { path_token: string };

export interface IngestSettings {
  readonly localTz: string;
  readonly maxBodyBytes: number;
  readonly elapsedCapS: number;
  getIngestKey(): Promise<string>;
  getIngestPathToken(): Promise<string>;
}

export interface WorkoutStoreLike {
  findExisting(
    dedupeKey: string,
    contentHash: string,
  ): Promise<StoredWorkout | null>;
  recordReceived(workout: ReceivedWorkout): Promise<void>;
  recordResult(dedupeKey: string, result: WorkoutResult): Promise<void>;
}

export interface ActivityClient {
  createActivity(activity: CreateActivityInput): Promise<CreateActivityResult>;
}

export interface RequestLog {
  request_id: string;
  dedupe_key: string | null;
  outcome: string;
  elapsed_s: number | null;
  strava_latency_s: number | null;
  rate_limit_headers: StravaUsage | null;
}

export interface CreateAppOptions {
  settings?: IngestSettings;
  store?: WorkoutStoreLike;
  strava?: ActivityClient;
  now?: () => Date;
  log?: (record: RequestLog) => void;
}

interface RequestState {
  requestId: string;
  dedupeKey: string | null;
  elapsedS: number | null;
  outcome: string;
  stravaLatencyS: number | null;
  rateLimitHeaders: StravaUsage | null;
  authFailed: boolean;
}

/**
 * Build the Fastify app without listening, so callers and tests can use
 * `app.inject()`. Production startup is at the bottom of this module.
 */
export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  let runtimeSettings: Settings | undefined;
  let settings: IngestSettings;
  if (options.settings === undefined) {
    runtimeSettings = loadSettings();
    settings = runtimeSettings;
  } else {
    settings = options.settings;
  }
  const store = options.store ?? defaultStore();
  const strava =
    options.strava ??
    (runtimeSettings === undefined
      ? unavailableActivityClient()
      : defaultStravaClient(runtimeSettings));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((record: RequestLog) => console.log(JSON.stringify(record)));
  const states = new WeakMap<FastifyRequest, RequestState>();

  const app = Fastify({ bodyLimit: settings.maxBodyBytes });

  // Keep the raw payload until this route selects its supported representation.
  // Fastify's bodyLimit still protects requests without Content-Length.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  app.addHook("onRequest", (request, _reply, done) => {
    states.set(request, {
      requestId: randomUUID(),
      dedupeKey: null,
      elapsedS: null,
      outcome: "internal_error",
      stravaLatencyS: null,
      rateLimitHeaders: null,
      authFailed: false,
    });
    done();
  });

  app.addHook("onResponse", (request, _reply, done) => {
    const state = states.get(request);
    if (state !== undefined && !state.authFailed) {
      log({
        request_id: state.requestId,
        dedupe_key: state.dedupeKey,
        outcome: state.outcome,
        elapsed_s: state.elapsedS,
        strava_latency_s: state.stravaLatencyS,
        rate_limit_headers: state.rateLimitHeaders,
      });
    }
    // For bad auth, do not log request metadata. This one counter-shaped line
    // is the only authentication-failure signal permitted by §11.
    if (state?.authFailed === true) {
      console.log(JSON.stringify({ outcome: "auth_failed" }));
    }
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const state = states.get(request);
    if (state !== undefined) {
      state.outcome = "internal_error";
    }
    const errorCode =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
    if (errorCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
      if (state !== undefined) {
        state.outcome = "payload_too_large";
      }
      void reply.code(413).type("text/plain").send("payload too large");
      return;
    }
    void reply.code(500).type("text/plain").send(internalError(state));
  });

  app.get("/healthz", async (_request, reply) => {
    const state = states.get(_request);
    if (state !== undefined) {
      state.outcome = "healthy";
    }
    return reply.type("text/plain").send("ok");
  });

  app.post<{ Params: IngestParams }>("/ingest/:path_token", {
    onRequest: async (request, reply) => {
      const state = states.get(request);
      const suppliedKey = headerValue(request.headers["x-ingest-key"]);
      const [expectedKey, expectedPathToken] = await Promise.all([
        settings.getIngestKey(),
        settings.getIngestPathToken(),
      ]);

      if (
        !safeSecretEqual(suppliedKey, expectedKey) ||
        !safeSecretEqual(request.params.path_token, expectedPathToken)
      ) {
        if (state !== undefined) {
          state.outcome = "auth_failed";
          state.authFailed = true;
        }
        return reply.code(404).send();
      }

      const contentLength = contentLengthHeader(request.headers["content-length"]);
      if (contentLength !== null && contentLength > settings.maxBodyBytes) {
        if (state !== undefined) {
          state.outcome = "payload_too_large";
        }
        return reply.code(413).type("text/plain").send("payload too large");
      }
    },
    handler: async (request, reply) => {
      const state = states.get(request);
      const rawText = requestText(request);
      const receivedAt = DateTime.fromJSDate(now(), { zone: settings.localTz });

      let workout;
      try {
        workout = parseWorkout(rawText);
      } catch (error: unknown) {
        if (!(error instanceof ParseError)) {
          return failInternal(reply, state);
        }

        const parseFailureKey = rawTextHash(rawText);
        if (state !== undefined) {
          state.dedupeKey = parseFailureKey;
          state.outcome = "unparseable";
        }
        try {
          await store.recordReceived({
            dedupe_key: parseFailureKey,
            content_hash: parseFailureKey,
            raw_text: rawText,
            parsed: null,
            started_at: null,
            elapsed_s: null,
            received_at: Timestamp.fromDate(receivedAt.toJSDate()),
          });
        } catch {
          return failInternal(reply, state);
        }
        return reply.code(400).type("text/plain").send("not a Strong workout");
      }

      const workoutDedupeKey = dedupeKey(workout);
      const workoutContentHash = contentHash(workout);
      if (state !== undefined) {
        state.dedupeKey = workoutDedupeKey;
      }

      let existing: StoredWorkout | null;
      try {
        existing = await store.findExisting(workoutDedupeKey, workoutContentHash);
      } catch {
        return failInternal(reply, state);
      }

      if (existing !== null) {
        if (state !== undefined) {
          state.outcome = "already_posted";
        }
        return reply
          .code(200)
          .type("text/plain")
          .send(limitResponse(`already posted: ${displayUrl(existing.strava?.url)}`));
      }

      const summary = summarizeWorkout(workout);
      const elapsedS = elapsedSeconds(
        workout.started_at,
        receivedAt,
        summary.total_sets,
        settings.elapsedCapS,
      );
      if (state !== undefined) {
        state.elapsedS = elapsedS;
      }

      try {
        await store.recordReceived({
          dedupe_key: workoutDedupeKey,
          content_hash: workoutContentHash,
          raw_text: rawText,
          parsed: workout,
          started_at: Timestamp.fromDate(
            DateTime.fromISO(workout.started_at, { zone: settings.localTz }).toJSDate(),
          ),
          elapsed_s: elapsedS,
          received_at: Timestamp.fromDate(receivedAt.toJSDate()),
        });
      } catch {
        return failInternal(reply, state);
      }

      // §8 formatting is synchronous, local, and happens only after the
      // idempotency record is durable and before the Strava call.
      const activityText = formatActivityText(summary, {
        per_exercise: {},
        pr_flags: {},
      });

      let result: CreateActivityResult;
      const stravaStartedAt = Date.now();
      try {
        result = await strava.createActivity({
          name: activityText.title,
          description: activityText.description,
          start_date_local: workout.started_at,
          elapsed_time: elapsedS,
        });
      } catch (error: unknown) {
        if (state !== undefined) {
          state.stravaLatencyS = secondsSince(stravaStartedAt);
          state.rateLimitHeaders = error instanceof StravaApiError ? error.usage : null;
        }
        try {
          await store.recordResult(workoutDedupeKey, {
            status: "failed",
            strava: null,
            error: stravaReason(error),
          });
        } catch {
          return failInternal(reply, state);
        }
        if (state !== undefined) {
          state.outcome = "strava_rejected";
        }
        return reply
          .code(502)
          .type("text/plain")
          .send(limitResponse(`strava rejected: ${stravaReason(error)}`));
      }

      if (state !== undefined) {
        state.stravaLatencyS = secondsSince(stravaStartedAt);
      }
      try {
        await store.recordResult(workoutDedupeKey, {
          status: "posted",
          strava: {
            activity_id: result.id,
            upload_id: null,
            url: result.url,
            method: "activities",
          },
          error: null,
        });
      } catch {
        return failInternal(reply, state);
      }

      if (state !== undefined) {
        state.outcome = "posted";
      }
      return reply
        .code(200)
        .type("text/plain")
        .send(limitResponse(`posted: ${activityText.title} · ${displayUrl(result.url)}`));
    },
  });

  return app;
}

/** Backwards-friendly name for consumers looking for an app factory. */
export const buildApp = createApp;

function defaultStore(): WorkoutStore {
  return new WorkoutStore(firestoreWorkouts(new Firestore()));
}

function defaultStravaClient(settings: Settings): StravaClient {
  const stravaSettings: StravaSettings = {
    getStravaClientId: async () => settings.stravaClientId,
    getStravaClientSecret: () => settings.getStravaClientSecret(),
    getStravaRefreshToken: () => settings.getStravaRefreshToken(),
    addStravaRefreshTokenVersion: (value) =>
      settings.addStravaRefreshTokenVersion(value),
  };
  // The route emits the one permitted request log line; suppress the client's
  // transport-level logs so a request never produces duplicate log records.
  return new StravaClient({ settings: stravaSettings, log: () => undefined });
}

function unavailableActivityClient(): ActivityClient {
  return {
    async createActivity(): Promise<CreateActivityResult> {
      throw new Error("No Strava client was supplied to the app factory.");
    },
  };
}

function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function contentLengthHeader(value: string | string[] | undefined): number | null {
  const raw = headerValue(value);
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function safeSecretEqual(supplied: string, expected: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function requestText(request: FastifyRequest): string {
  const body = request.body;
  const contentType = headerValue(request.headers["content-type"]).toLowerCase();
  if (typeof body !== "string") {
    return "";
  }
  if (contentType.startsWith("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { text?: unknown }).text === "string"
      ) {
        return (parsed as { text: string }).text;
      }
    } catch {
      // An invalid JSON body follows the same unparseable-text persistence path.
    }
    return body;
  }
  return body;
}

function rawTextHash(rawText: string): string {
  return `sha256:${createHash("sha256")
    .update(rawText, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function displayUrl(url: string | null | undefined): string {
  if (url === null || url === undefined || url === "") {
    return "Strava activity";
  }
  return url.replace(/^https:\/\/(?:www\.)?/, "");
}

function limitResponse(value: string): string {
  return value.length <= MAX_RESPONSE_LENGTH ? value : value.slice(0, MAX_RESPONSE_LENGTH);
}

function secondsSince(startedAt: number): number {
  return Math.round((Date.now() - startedAt) * 1000) / 1000;
}

function stravaReason(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message.replace(/[\r\n]+/g, " ");
  }
  return "Strava request failed";
}

function internalError(state: RequestState | undefined): string {
  return `internal error: ${state?.requestId ?? randomUUID()}`;
}

function failInternal(reply: FastifyReply, state: RequestState | undefined): FastifyReply {
  if (state !== undefined) {
    state.outcome = "internal_error";
  }
  return reply.code(500).type("text/plain").send(internalError(state));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  void app.listen({
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 8080),
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
