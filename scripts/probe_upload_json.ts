import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import { loadSettings } from "../app/config.js";
import { StravaClient, type StravaSettings } from "../app/strava.js";

/**
 * One-shot probe for open item 3 (docs/planning/11-open-items-and-sources.md):
 * does POST /uploads accept a JSON strength-training file, and is the
 * multipart field named 'data_type' or 'dataType'? Both are [U] in §7.4.
 *
 * The probe posts one minimal JSON set body per candidate field name, polls
 * GET /uploads/{id} to a terminal state, deletes any activity it creates, and
 * prints a verdict per field name. It is disposable scaffolding (ADR 0004),
 * not part of the service.
 *
 * CONSTRAINTS rule 2: every raw Strava response — including the read payloads
 * from polling — goes to a JSONL file outside the repo, and only authored
 * verdict lines are printed. Rule 7: no secret is ever printed; the access
 * token lives only inside request headers.
 */

const UPLOADS_URL = "https://www.strava.com/api/v3/uploads";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/activities";

const FIELD_NAMES = ["data_type", "dataType"] as const;
type FieldName = (typeof FIELD_NAMES)[number];

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 30_000;

const PROBE_ELAPSED_TIME_S = 300;
const PROBE_EXERCISE_TYPE = "BENCH_PRESS_GENERIC";

/**
 * An error whose message was authored in this file and is therefore safe to
 * print. Anything else — including a StravaApiError carrying a Strava fault
 * string — is reported generically (CONSTRAINTS rules 2 and 7).
 */
class ProbeError extends Error {}

interface AttemptResult {
  fieldName: FieldName;
  /** A definite verdict was reached; an inconclusive attempt fails the probe. */
  definite: boolean;
  /** Strava accepted the JSON upload and turned it into an activity. */
  accepted: boolean;
  verdict: string;
}

type PollResult =
  | { kind: "activity"; activityId: string }
  | { kind: "error"; error: string }
  | { kind: "timeout" };

interface ProbeDeps {
  accessToken: string;
  payloadLogPath: string;
}

function logPayload(
  path: string,
  entry: {
    attempt: string;
    kind: "upload_response" | "poll_response" | "delete_response";
    httpStatus: number;
    responseBody: unknown;
  },
): void {
  appendFileSync(
    path,
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    "utf8",
  );
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The JSON body posted as the upload file. The envelope and set fields follow
 * the 'JSON - Strength Training (Limited)' section of Strava's uploads
 * documentation — note that its set objects use 'exercise_type', not the
 * 'set_type'/'category' field names §7.4 lists from the FIT set message and
 * the changelog summary. Each call embeds the current time so the two
 * attempts upload distinct files and cannot dedupe against each other.
 */
function buildProbeFile(): string {
  const startIso = new Date().toISOString();
  const utcOffsetSeconds = -new Date().getTimezoneOffset() * 60;
  return JSON.stringify({
    version: "1.0",
    start_time: startIso,
    utc_offset: utcOffsetSeconds,
    elapsed_time: PROBE_ELAPSED_TIME_S,
    creator: { name: "strava-bot t25 probe" },
    sets: [
      {
        exercise_type: PROBE_EXERCISE_TYPE,
        repetitions: 10,
        weight: 60,
        start_time: startIso,
      },
    ],
  });
}

function buildForm(fieldName: FieldName): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buildProbeFile()], { type: "application/json" }),
    "probe.json",
  );
  form.append(fieldName, "json");
  form.append("name", "strava-bot T25 probe (" + fieldName + ")");
  form.append(
    "description",
    "One-shot probe for open item 3; deleted automatically on success.",
  );
  form.append("external_id", "t25-probe-" + fieldName + "-" + Date.now());
  form.append("activity_type", "WeightTraining");
  return form;
}

/**
 * Bucket a Strava upload-processing error into an authored label, so the raw
 * error string itself never has to leave the payload log (CONSTRAINTS rule 2).
 */
function classifyUploadError(error: string): string {
  if (/data_?type/i.test(error)) {
    return "error names the data-type field";
  }
  if (/duplicate/i.test(error)) {
    return "error indicates a duplicate submission";
  }
  if (/format|parse|invalid|corrupt|process/i.test(error)) {
    return "error indicates the file content was rejected";
  }
  return "error text not classified (see payload log)";
}

/** Same idea for a rejected intake response, whose fault body may hint at why. */
function classifyIntakeFault(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  if (/data_?type/i.test(text)) {
    return "response names the data-type field";
  }
  if (/file/i.test(text)) {
    return "response names the file";
  }
  return "response body not classified (see payload log)";
}

function extractUploadId(body: unknown): string | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const id = (body as Record<string, unknown>).id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }
  if (typeof id === "string" && id !== "") {
    return id;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUpload(
  uploadId: string,
  fieldName: FieldName,
  deps: ProbeDeps,
): Promise<PollResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await fetch(UPLOADS_URL + "/" + uploadId, {
      headers: { authorization: "Bearer " + deps.accessToken },
    });
    const body = await parseBody(response);
    logPayload(deps.payloadLogPath, {
      attempt: fieldName,
      kind: "poll_response",
      httpStatus: response.status,
      responseBody: body,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProbeError(
        "Strava rejected the access token while polling; the probe cannot run.",
      );
    }

    if (body !== null && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string" && record.error !== "") {
        return { kind: "error", error: record.error };
      }
      const activityId = record.activity_id;
      if (typeof activityId === "number" && Number.isFinite(activityId)) {
        return { kind: "activity", activityId: String(activityId) };
      }
      if (typeof activityId === "string" && activityId !== "") {
        return { kind: "activity", activityId };
      }
    }

    if (Date.now() >= deadline) {
      return { kind: "timeout" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Returns true when the activity is gone. Never throws: cleanup is best-effort.
 * Observed 2026-09-17: the probe's own create 404'd on DELETE (and GET)
 * immediately and persistently after the upload reported success — an activity
 * whose visibility keeps it out of the app's scope (e.g. a private athlete
 * default) is not deletable through the API and needs manual removal; the
 * caller's verdict line says so and names the id for exactly that case.
 */
async function deleteActivity(
  activityId: string,
  fieldName: FieldName,
  deps: ProbeDeps,
): Promise<boolean> {
  const response = await fetch(ACTIVITIES_URL + "/" + activityId, {
    method: "DELETE",
    headers: { authorization: "Bearer " + deps.accessToken },
  });
  logPayload(deps.payloadLogPath, {
    attempt: fieldName,
    kind: "delete_response",
    httpStatus: response.status,
    responseBody: await parseBody(response),
  });
  return response.status >= 200 && response.status < 300;
}

async function probeFieldName(
  fieldName: FieldName,
  deps: ProbeDeps,
): Promise<AttemptResult> {
  const rejected = (verdict: string): AttemptResult => ({
    fieldName,
    definite: true,
    accepted: false,
    verdict,
  });

  const response = await fetch(UPLOADS_URL, {
    method: "POST",
    headers: { authorization: "Bearer " + deps.accessToken },
    body: buildForm(fieldName),
  });
  const body = await parseBody(response);
  logPayload(deps.payloadLogPath, {
    attempt: fieldName,
    kind: "upload_response",
    httpStatus: response.status,
    responseBody: body,
  });

  if (response.status === 401 || response.status === 403) {
    throw new ProbeError(
      "Strava rejected the access token at intake; the probe cannot run.",
    );
  }
  if (response.status === 429) {
    throw new ProbeError("Strava rate-limited the probe; re-run later.");
  }
  if (response.status < 200 || response.status >= 300) {
    return rejected(
      "rejected at intake (HTTP " + response.status + "; " +
        classifyIntakeFault(body) + ")",
    );
  }

  const uploadId = extractUploadId(body);
  if (uploadId === null) {
    return {
      fieldName,
      definite: false,
      accepted: false,
      verdict:
        "inconclusive — intake returned HTTP " + response.status +
        " but no upload id",
    };
  }

  const poll = await pollUpload(uploadId, fieldName, deps);
  if (poll.kind === "timeout") {
    return {
      fieldName,
      definite: false,
      accepted: false,
      verdict:
        "inconclusive — no terminal state within " +
        POLL_TIMEOUT_MS / 1000 + "s",
    };
  }
  if (poll.kind === "error") {
    return rejected(
      "rejected during processing (" + classifyUploadError(poll.error) + ")",
    );
  }

  const deleted = await deleteActivity(poll.activityId, fieldName, deps);
  return {
    fieldName,
    definite: true,
    accepted: true,
    verdict: deleted
      ? "accepted — activity created and deleted"
      : "accepted — activity created; AUTOMATIC DELETE FAILED, remove activity " +
        poll.activityId + " manually",
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const settings = loadSettings();
  // Same Settings-to-StravaSettings adapter as app/main.ts: reusing the client
  // gets token caching and rotated-refresh-token persistence (rule 8) for free.
  const stravaSettings: StravaSettings = {
    getStravaClientId: async () => settings.stravaClientId,
    getStravaClientSecret: () => settings.getStravaClientSecret(),
    getStravaRefreshToken: () => settings.getStravaRefreshToken(),
    reloadStravaRefreshToken: () => settings.reloadStravaRefreshToken(),
    addStravaRefreshTokenVersion: (value) =>
      settings.addStravaRefreshTokenVersion(value),
  };
  const client = new StravaClient({ settings: stravaSettings });
  const deps: ProbeDeps = {
    accessToken: await client.getAccessToken(),
    payloadLogPath: join(
      tmpdir(),
      "strava-bot-t25-probe-" + Date.now() + ".jsonl",
    ),
  };

  const results: AttemptResult[] = [];
  for (const fieldName of FIELD_NAMES) {
    results.push(await probeFieldName(fieldName, deps));
  }

  for (const result of results) {
    console.log(result.fieldName + "=json: " + result.verdict);
  }

  const accepted = results
    .filter((result) => result.accepted)
    .map((result) => result.fieldName);
  console.log(
    accepted.length > 0
      ? "verdict: POST /uploads accepts JSON; accepted field name(s): " +
        accepted.join(", ")
      : "verdict: POST /uploads did not accept JSON under either field name",
  );
  console.log(
    "full Strava responses (kept out of VCS and agent context): " +
      deps.payloadLogPath,
  );

  if (results.some((result) => !result.definite)) {
    throw new ProbeError(
      "Probe ended without a definite verdict for every field name; re-run it.",
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    if (error instanceof ProbeError) {
      console.error(error.message);
    } else {
      console.error("Probe failed.");
    }
    process.exitCode = 1;
  });
}
