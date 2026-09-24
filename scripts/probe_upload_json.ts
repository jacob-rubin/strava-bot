import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import { DateTime } from "luxon";

import { formatActivityText } from "../app/activity_text.js";
import { loadSettings, type Settings } from "../app/config.js";
import { resolveExerciseType } from "../app/exercises/exercise_type.js";
import { deriveWorkoutTiming } from "../app/ingest/workout_timing.js";
import type { ExerciseSummary, HistoryContext, WorkoutSummary } from "../app/models.js";
import { DATE_LINE_FORMAT, parseWorkout, summarizeWorkout } from "../app/parser.js";
import {
  StravaApiError,
  StravaClient,
  type ActivityUploadInput,
  type ActivityUploadResult,
  type StravaFetch,
  type StravaResponseLike,
  type StravaSettings,
  type StructuredWorkoutInput,
} from "../app/strava.js";

/**
 * Pre-deploy check of the shipped upload path: the canonical fixture goes
 * through the service's own parse, timing, formatting, and
 * StravaClient.uploadActivity, so one live run exercises exactly what a deploy
 * will send. See docs/operations.md and docs/reference/strava.md.
 *
 * An upload-created activity 404s on API GET and DELETE, so the probe can only
 * confirm Strava accepted the upload; how it rendered is checked by eye on
 * strava.com, and the activity is then deleted by hand.
 *
 * Constraint 2: every Strava response body goes to a JSONL file outside the
 * repo, and only authored lines are printed. Constraint 7: the token response
 * body is redacted before it is written, and request bodies and headers are
 * never written at all.
 */

const FIXTURE_URL = new URL("../tests/fixtures/canonical.txt", import.meta.url);
const PROBE_TITLE_PREFIX = "[probe] ";
const PROBE_START_MINUTES_AGO = 45;
const POUNDS_TO_KILOGRAMS = 0.45359237;
const DRY_RUN_CREDENTIAL = "dry-run";
const NO_HISTORY: HistoryContext = { per_exercise: {}, pr_flags: {} };

/** A failure whose message was authored in this file and is safe to print. */
class ProbeError extends Error {}

/** Thrown by the dry-run fetch once the upload form is printed; not a failure. */
class DryRunComplete extends Error {}

interface ProbeUpload {
  readonly summary: WorkoutSummary;
  readonly activity: ActivityUploadInput;
  readonly workout: StructuredWorkoutInput;
}

function appendLog(path: string, entry: Record<string, unknown>): void {
  appendFileSync(
    path,
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    "utf8",
  );
}

function parseBodyText(text: string): unknown {
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isTokenPath(path: string): boolean {
  return path.endsWith("/oauth/token");
}

function responseLike(status: number, headers: Headers, text: string): StravaResponseLike {
  return {
    status,
    headers: { get: (name) => headers.get(name) },
    json: () => Promise.resolve(JSON.parse(text) as unknown),
  };
}

/** The canonical fixture, re-dated so each run is new to Strava's duplicate check. */
function buildProbeUpload(settings: Settings): ProbeUpload {
  const receivedAt = DateTime.now().setZone(settings.localTz);
  const dateLine = receivedAt
    .minus({ minutes: PROBE_START_MINUTES_AGO })
    .setLocale("en-US")
    .toFormat(DATE_LINE_FORMAT);
  const lines = readFileSync(FIXTURE_URL, "utf8").split(/\r?\n/);
  if (lines.length < 2) {
    throw new ProbeError("The canonical fixture has no date line to replace.");
  }
  lines[1] = dateLine;

  const parsed = parseWorkout(lines.join("\n"));
  const summary = summarizeWorkout(parsed);
  const timing = deriveWorkoutTiming({
    workout: parsed,
    summary,
    receivedAt,
    settings,
  });
  const text = formatActivityText(summary, NO_HISTORY);

  return {
    summary,
    activity: {
      name: PROBE_TITLE_PREFIX + text.title,
      description: text.description,
      elapsed_time: timing.elapsedS,
    },
    workout: {
      start_time_utc: timing.startedAtUtc,
      utc_offset: timing.utcOffsetSeconds,
      exercises: summary.exercises,
    },
  };
}

function exerciseLabel(exercise: ExerciseSummary): string {
  return exercise.equipment === null
    ? exercise.name
    : exercise.name + " (" + exercise.equipment + ")";
}

/** An unmapped fixture exercise would mean the probe no longer tests the map. */
function printExerciseMap(exercises: readonly ExerciseSummary[]): void {
  const unmapped: string[] = [];
  for (const exercise of exercises) {
    const resolved = resolveExerciseType(exercise.name, exercise.equipment);
    console.log(
      "exercise map: " + exerciseLabel(exercise) + " -> " + resolved.exercise_type,
    );
    if (!resolved.mapped) {
      unmapped.push(exerciseLabel(exercise));
    }
  }
  if (unmapped.length > 0) {
    throw new ProbeError(
      "Fixture exercise(s) not in the exercise-type map: " + unmapped.join(", "),
    );
  }
}

/** Constraint 7: the token response is redacted; request bodies are never logged. */
function loggingFetch(logPath: string): StravaFetch {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init);
    const text = await response.text();
    const path = new URL(url).pathname;
    appendLog(logPath, {
      kind: "strava_response",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      body: isTokenPath(path) ? "[redacted: token response]" : parseBodyText(text),
    });
    return responseLike(response.status, response.headers, text);
  };
}

function liveClient(settings: Settings, logPath: string): StravaClient {
  const stravaSettings: StravaSettings = {
    getStravaClientId: () => Promise.resolve(settings.stravaClientId),
    getStravaClientSecret: () => settings.getStravaClientSecret(),
    getStravaRefreshToken: () => settings.getStravaRefreshToken(),
    reloadStravaRefreshToken: () => settings.reloadStravaRefreshToken(),
    addStravaRefreshTokenVersion: (value) =>
      settings.addStravaRefreshTokenVersion(value),
  };
  return new StravaClient({
    settings: stravaSettings,
    fetch: loggingFetch(logPath),
    log: (line) => appendLog(logPath, { kind: "client_log", line }),
  });
}

function formField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "(absent)";
}

async function printUploadForm(form: FormData): Promise<void> {
  for (const name of ["data_type", "sport_type", "name", "description"]) {
    console.log(name + ": " + formField(form, name));
  }
  console.log("activity_type present: " + String(form.has("activity_type")));
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new ProbeError("Dry run: the upload form carried no file.");
  }
  console.log("file:");
  console.log(JSON.stringify(JSON.parse(await file.text()) as unknown, null, 2));
}

/** Answers the token refresh locally and stops at the upload; reads no secret. */
function dryRunFetch(): StravaFetch {
  return async (url, init) => {
    const path = new URL(url).pathname;
    if (isTokenPath(path)) {
      const token = JSON.stringify({
        token_type: "Bearer",
        access_token: DRY_RUN_CREDENTIAL,
        refresh_token: DRY_RUN_CREDENTIAL,
        expires_at: Math.floor(Date.now() / 1_000) + 3_600,
      });
      return responseLike(200, new Headers(), token);
    }
    if (init?.method === "POST" && path.endsWith("/uploads") && init.body instanceof FormData) {
      await printUploadForm(init.body);
      throw new DryRunComplete();
    }
    throw new ProbeError("Dry run: unexpected request to " + path + "; nothing was sent.");
  };
}

function dryRunClient(logPath: string): StravaClient {
  const stravaSettings: StravaSettings = {
    getStravaClientId: () => Promise.resolve(DRY_RUN_CREDENTIAL),
    getStravaClientSecret: () => Promise.resolve(DRY_RUN_CREDENTIAL),
    getStravaRefreshToken: () => Promise.resolve(DRY_RUN_CREDENTIAL),
    addStravaRefreshTokenVersion: () =>
      Promise.reject(new ProbeError("Dry run tried to persist a refresh token.")),
  };
  return new StravaClient({
    settings: stravaSettings,
    fetch: dryRunFetch(),
    log: (line) => appendLog(logPath, { kind: "client_log", line }),
  });
}

function printAccepted(
  result: ActivityUploadResult,
  summary: WorkoutSummary,
  logPath: string,
): void {
  const setCount = summary.exercises.reduce(
    (count, exercise) => count + exercise.sets.length,
    0,
  );
  console.log("accepted: upload " + result.upload_id + " became activity " + result.id);
  console.log("open: " + result.url);
  console.log("check on strava.com:");
  console.log("  - sport type is Weight Training");
  console.log(
    "  - exercises: " + summary.exercises.map((exercise) => exercise.name).join(", "),
  );
  console.log("  - " + setCount + " sets in total");
  const first = summary.exercises[0];
  if (first?.top_set?.unit === "lb") {
    const kilograms = (first.top_set.weight * POUNDS_TO_KILOGRAMS).toFixed(1);
    console.log(
      "  - " + first.name + " shows about " + kilograms + " kg (" +
        first.top_set.weight + " lb)",
    );
  }
  console.log(
    "the API cannot delete this activity (GET and DELETE return 404); " +
      "remove it by hand on strava.com once checked",
  );
  console.log("full Strava responses (token redacted, kept out of VCS): " + logPath);
}

/** Constraints 2 and 7: Strava fault text goes to the log file, never stdout. */
function reportFailure(error: unknown, logPath: string): ProbeError {
  if (error instanceof ProbeError) {
    return error;
  }
  if (error instanceof StravaApiError) {
    appendLog(logPath, {
      kind: "failure",
      name: error.name,
      status: error.status,
      stage: error.stage ?? null,
      message: error.message,
      fault: error.fault ?? null,
    });
    return new ProbeError(
      "rejected: stage=" + (error.stage ?? "unknown") + " status=" + error.status +
        " (details in " + logPath + ")",
    );
  }
  const name = error instanceof Error ? error.name : "non-Error value";
  appendLog(logPath, {
    kind: "failure",
    name,
    message: error instanceof Error ? error.message : String(error),
  });
  return new ProbeError("Probe failed: " + name + " (details in " + logPath + ")");
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  loadEnvFile();
  const settings = loadSettings();
  const logPath = join(tmpdir(), "strava-bot-upload-probe-" + Date.now() + ".jsonl");

  const probe = buildProbeUpload(settings);
  printExerciseMap(probe.summary.exercises);
  const client = dryRun ? dryRunClient(logPath) : liveClient(settings, logPath);

  try {
    const result = await client.uploadActivity(probe.activity, probe.workout);
    printAccepted(result, probe.summary, logPath);
  } catch (error: unknown) {
    if (error instanceof DryRunComplete) {
      console.log("dry run: nothing was sent");
      return;
    }
    throw reportFailure(error, logPath);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof ProbeError
        ? error.message
        : "Probe failed: " + (error instanceof Error ? error.name : "non-Error value"),
    );
    process.exitCode = 1;
  });
}

