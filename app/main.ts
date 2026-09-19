/** Strong-to-Strava ingest entrypoint. The request ordering here is fixed by §5. */

import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Timestamp } from "@google-cloud/firestore";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { DateTime } from "luxon";

import { formatActivityText } from "./activity_text.js";
import {
  logAuthFailed,
  logRequest,
  newRequestState,
  toRequestLog,
  type RequestLog,
  type RequestState,
} from "./logging.js";
import {
  contentHash,
  dedupeKey,
  elapsedSeconds,
  ParseError,
  parseWorkout,
  summarizeWorkout,
} from "./parser.js";
import {
  defaultStravaClient,
  unavailableActivityClient,
  type ActivityClient,
} from "./ports/activity_client.js";
import { resolveSettings, type IngestSettings } from "./ports/ingest_settings.js";
import { defaultStore, type WorkoutStoreLike } from "./ports/workout_store_like.js";
import {
  StravaApiError,
  type StructuredWorkoutInput,
} from "./strava.js";
import { attempt, attemptSync } from "./util/attempt.js";

const MAX_RESPONSE_LENGTH = 200;

type IngestParams = { path_token: string };

export interface CreateAppOptions {
  readonly settings?: IngestSettings;
  readonly store?: WorkoutStoreLike;
  readonly strava?: ActivityClient;
  readonly now?: () => Date;
  readonly log?: (record: RequestLog) => void;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const { settings, runtimeSettings } = resolveSettings(options.settings);
  const store = options.store ?? defaultStore();
  const strava =
    options.strava ??
    (runtimeSettings === null
      ? unavailableActivityClient()
      : defaultStravaClient(runtimeSettings));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? logRequest;
  const states = new WeakMap<FastifyRequest, RequestState>();
  const requestState = (request: FastifyRequest): RequestState => {
    const state = states.get(request);
    if (state === undefined) {
      throw new Error("request state is missing: the onRequest hook did not run");
    }
    return state;
  };

  const app = Fastify({ bodyLimit: settings.maxBodyBytes });

  // Bodies stay raw: constraint 6 persists exactly the text that was sent.
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
    states.set(request, newRequestState());
    done();
  });

  app.addHook("onResponse", (request, _reply, done) => {
    const state = requestState(request);
    if (state.authFailed) {
      logAuthFailed();
    } else {
      log(toRequestLog(state, settings.debugLogRawText));
    }
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const state = requestState(request);
    state.outcome = "internal_error";
    const errorCode =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
    if (errorCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
      state.outcome = "payload_too_large";
      void reply.code(413).type("text/plain").send("payload too large");
      return;
    }
    void reply.code(500).type("text/plain").send(internalError(state));
  });

  app.get("/health", (request, reply) => {
    requestState(request).outcome = "healthy";
    reply.type("text/plain").send("ok");
  });

  app.post<{ Params: IngestParams }>("/ingest/:path_token", {
    onRequest: async (request, reply) => {
      const state = requestState(request);
      const suppliedKey = headerValue(request.headers["x-ingest-key"]);
      const [expectedKey, expectedPathToken] = await Promise.all([
        settings.getIngestKey(),
        settings.getIngestPathToken(),
      ]);

      if (
        !safeSecretEqual(suppliedKey, expectedKey) ||
        !safeSecretEqual(request.params.path_token, expectedPathToken)
      ) {
        state.outcome = "auth_failed";
        state.authFailed = true;
        return reply.code(404).send();
      }

      const contentLength = contentLengthHeader(request.headers["content-length"]);
      if (contentLength !== null && contentLength > settings.maxBodyBytes) {
        state.outcome = "payload_too_large";
        return reply.code(413).type("text/plain").send("payload too large");
      }
    },
    handler: async (request, reply) => {
      const state = requestState(request);
      const rawText = requestText(request);
      state.bodyBytes = Buffer.byteLength(rawText, "utf8");
      state.contentType = headerValue(request.headers["content-type"]) || null;
      state.rawText = rawText;
      const receivedAt = DateTime.fromJSDate(now(), { zone: settings.localTz });

      const parseResult = attemptSync(() => parseWorkout(rawText));
      if (!parseResult.ok) {
        if (!(parseResult.error instanceof ParseError)) {
          return failInternal(reply, state);
        }

        const parseFailureKey = rawTextHash(rawText);
        state.dedupeKey = parseFailureKey;
        state.outcome = "unparseable";
        const recorded = await attempt(() =>
          store.recordReceived({
            dedupe_key: parseFailureKey,
            content_hash: parseFailureKey,
            raw_text: rawText,
            parsed: null,
            started_at: null,
            elapsed_s: null,
            received_at: Timestamp.fromDate(receivedAt.toJSDate()),
          }),
        );
        if (!recorded.ok) {
          return failInternal(reply, state);
        }
        return reply.code(400).type("text/plain").send("not a Strong workout");
      }

      const workout = parseResult.value;
      const workoutDedupeKey = dedupeKey(workout);
      const workoutContentHash = contentHash(workout);
      state.dedupeKey = workoutDedupeKey;

      const lookup = await attempt(() =>
        store.findExisting(workoutDedupeKey, workoutContentHash),
      );
      if (!lookup.ok) {
        return failInternal(reply, state);
      }
      const existing = lookup.value;

      if (existing !== null && existing.status !== "failed") {
        state.outcome = "already_posted";
        return reply
          .code(200)
          .type("text/plain")
          .send(limitResponse(`already posted: ${displayUrl(existing.strava?.url)}`));
      }

      // A failed post keeps its record and attempt count, so sharing again retries
      // it instead of being turned away as a completed duplicate.
      const resultDedupeKey =
        existing?.status === "failed" ? existing.dedupe_key : workoutDedupeKey;

      const summary = summarizeWorkout(workout);
      const elapsedS = elapsedSeconds(
        workout.started_at,
        receivedAt,
        summary.total_sets,
        settings.elapsedCapS,
      );
      state.elapsedS = elapsedS;

      const startedAtDateTime = DateTime.fromISO(workout.started_at, {
        zone: settings.localTz,
      });
      const startedAtUtc = startedAtDateTime
        .toUTC()
        .toISO({ suppressMilliseconds: true });
      if (startedAtUtc === null) {
        return failInternal(reply, state);
      }
      const startedAt = Timestamp.fromDate(startedAtDateTime.toJSDate());

      if (existing === null) {
        const recorded = await attempt(() =>
          store.recordReceived({
            dedupe_key: workoutDedupeKey,
            content_hash: workoutContentHash,
            raw_text: rawText,
            parsed: workout,
            started_at: startedAt,
            elapsed_s: elapsedS,
            received_at: Timestamp.fromDate(receivedAt.toJSDate()),
          }),
        );
        if (!recorded.ok) {
          return failInternal(reply, state);
        }
      }

      // §6: history is read before the post so this workout never compares against itself.
      const history = await attempt(() => store.getHistoryContext(summary, startedAt));
      if (!history.ok) {
        return failInternal(reply, state);
      }

      // §8 / constraint 9: formatting is local and deterministic, never a network call.
      const activityText = formatActivityText(summary, history.value);

      const stravaStartedAt = Date.now();
      const created = await attempt(() => {
        const structuredWorkout: StructuredWorkoutInput = {
          start_time_utc: startedAtUtc,
          utc_offset: startedAtDateTime.offset * 60,
          exercises: summary.exercises,
        };
        return strava.createActivity(
          {
            name: activityText.title,
            description: activityText.description,
            start_date_local: workout.started_at,
            elapsed_time: elapsedS,
          },
          structuredWorkout,
        );
      });
      state.stravaLatencyS = secondsSince(stravaStartedAt);

      if (!created.ok) {
        const error = created.error;
        state.rateLimitHeaders = error instanceof StravaApiError ? error.usage : null;
        state.stravaFailureStage =
          error instanceof StravaApiError ? (error.stage ?? "unknown") : "unknown";
        state.stravaStatus = error instanceof StravaApiError ? error.status : null;
        const recordedFailure = await attempt(() =>
          store.recordResult(resultDedupeKey, {
            status: "failed",
            strava: null,
            error: stravaReason(error),
          }),
        );
        if (!recordedFailure.ok) {
          return failInternal(reply, state);
        }
        state.outcome = "strava_rejected";
        return reply
          .code(502)
          .type("text/plain")
          .send(limitResponse(`strava rejected: ${stravaReason(error)}`));
      }

      const result = created.value;
      const recordedResult = await attempt(() =>
        store.recordResult(resultDedupeKey, {
          status: "posted",
          strava: {
            activity_id: result.id,
            upload_id: result.upload_id ?? null,
            url: result.url,
            method: result.method ?? "activities",
          },
          error: null,
        }),
      );
      if (!recordedResult.ok) {
        return failInternal(reply, state);
      }

      state.outcome = "posted";
      return reply
        .code(200)
        .type("text/plain")
        .send(limitResponse(`posted: ${activityText.title} · ${displayUrl(result.url)}`));
    },
  });

  return app;
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
  if (typeof body !== "string") {
    return "";
  }
  const contentType = headerValue(request.headers["content-type"]).toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return body;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "text" in parsed &&
      typeof parsed.text === "string"
    ) {
      return parsed.text;
    }
  } catch {
    // Constraint 6: an invalid JSON body is persisted as unparseable text, not rejected.
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
  return Math.round(Date.now() - startedAt) / 1000;
}

function stravaReason(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message.replace(/[\r\n]+/g, " ");
  }
  return "Strava request failed";
}

function internalError(state: RequestState): string {
  return `internal error: ${state.requestId}`;
}

function failInternal(reply: FastifyReply, state: RequestState): FastifyReply {
  state.outcome = "internal_error";
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
