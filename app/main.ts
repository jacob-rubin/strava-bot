import { Timestamp } from "@google-cloud/firestore";
import Fastify, { type FastifyInstance } from "fastify";
import { DateTime } from "luxon";

import { formatActivityText } from "./activity_text.js";
import { ingestFailure, PayloadTooLargeError } from "./ingest/error.js";
import { parseWorkoutOrRecordRaw } from "./ingest/parse_stage.js";
import { postWorkoutActivity } from "./ingest/post_stage.js";
import { requiredStore } from "./ingest/required_store.js";
import { requestText } from "./ingest/request_text.js";
import {
  alreadyPostedResponse,
  postedResponse,
} from "./ingest/response_text.js";
import { deriveWorkoutTiming } from "./ingest/workout_timing.js";
import type { RequestLog } from "./logging.js";
import { contentHash, dedupeKey, summarizeWorkout } from "./parser.js";
import type { ActivityClient } from "./ports/activity_client.js";
import type { IngestSettings } from "./ports/ingest_settings.js";
import type { WorkoutStoreLike } from "./ports/workout_store_like.js";
import { contentLengthHeader, headerValue } from "./util/http_headers.js";
import { safeSecretEqual } from "./util/secret_comparison.js";

type IngestParams = { path_token: string };

export interface CreateAppOptions {
  readonly settings: IngestSettings;
  readonly store: WorkoutStoreLike;
  readonly strava: ActivityClient;
  readonly log: (record: RequestLog) => void;
}

export function createApp({
  settings,
  store,
  strava,
  log,
}: CreateAppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit: settings.maxBodyBytes });
  const workouts = requiredStore(store);

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

  app.setErrorHandler((error, _request, reply) => {
    const failure = ingestFailure(error);
    void reply
      .code(failure.statusCode)
      .type("text/plain")
      .send(failure.message);
  });

  app.get("/health", (_request, reply) => {
    reply.type("text/plain").send("ok");
  });

  app.post<{ Params: IngestParams }>("/ingest/:path_token", {
    // docs/reference/ingest-api.md: one line per ingest request, carrying the
    // payload and the status it produced. The hook is route-scoped, so a
    // health check logs nothing.
    onResponse: (request, reply, done) => {
      const record: RequestLog = { status: reply.statusCode };
      // Constraint 3: a bad auth gets the bare status counter and no request
      // data. Constraint 7 / ADR 0011: every other request logs its payload.
      if (reply.statusCode !== 404 && typeof request.body === "string") {
        record.raw_text = requestText(
          request.body,
          headerValue(request.headers["content-type"]),
        );
      }
      log(record);
      done();
    },
    onRequest: async (request, reply) => {
      const suppliedKey = headerValue(request.headers["x-ingest-key"]);
      const [expectedKey, expectedPathToken] = await Promise.all([
        settings.getIngestKey(),
        settings.getIngestPathToken(),
      ]);

      if (
        !safeSecretEqual(suppliedKey, expectedKey) ||
        !safeSecretEqual(request.params.path_token, expectedPathToken)
      ) {
        return reply.code(404).send();
      }

      const contentLength = contentLengthHeader(
        request.headers["content-length"],
      );
      if (contentLength !== null && contentLength > settings.maxBodyBytes) {
        throw new PayloadTooLargeError();
      }
    },
    handler: async (request, reply) => {
      const contentType = headerValue(request.headers["content-type"]);
      const rawText = requestText(request.body, contentType);
      const receivedAt = DateTime.now().setZone(settings.localTz);

      const workout = await parseWorkoutOrRecordRaw({
        store: workouts,
        rawText,
        receivedAt,
      });
      const workoutDedupeKey = dedupeKey(workout);
      const workoutContentHash = contentHash(workout);

      const existing = await workouts.findExisting(
        workoutDedupeKey,
        workoutContentHash,
      );

      if (existing !== null && existing.status !== "failed") {
        return reply
          .code(200)
          .type("text/plain")
          .send(alreadyPostedResponse(existing.strava?.url));
      }

      // Persistence: a failed post keeps its record and attempt count, so sharing
      // again retries it instead of being turned away as a completed duplicate.
      const resultDedupeKey =
        existing?.status === "failed" ? existing.dedupe_key : workoutDedupeKey;

      const summary = summarizeWorkout(workout);
      const timing = deriveWorkoutTiming({
        workout,
        summary,
        receivedAt,
        settings,
      });

      if (existing === null) {
        await workouts.recordReceived({
          dedupe_key: workoutDedupeKey,
          content_hash: workoutContentHash,
          raw_text: rawText,
          parsed: workout,
          started_at: timing.startedAt,
          elapsed_s: timing.elapsedS,
          received_at: Timestamp.fromDate(receivedAt.toJSDate()),
        });
      }

      // History is read before the post, so this workout never compares against itself.
      const history = await workouts.getHistoryContext(
        summary,
        timing.startedAt,
      );

      // Constraint 9: formatting is local and deterministic, never a network call.
      const activityText = formatActivityText(summary, history);

      const result = await postWorkoutActivity({
        strava,
        store: workouts,
        resultDedupeKey,
        activityText,
        summary,
        timing,
      });

      return reply
        .code(200)
        .type("text/plain")
        .send(postedResponse(activityText.title, result.url));
    },
  });

  return app;
}
