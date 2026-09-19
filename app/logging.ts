import { randomUUID } from "node:crypto";

import type { StravaFailureStage, StravaUsage } from "./strava.js";

export interface RequestLog {
  request_id: string;
  dedupe_key: string | null;
  outcome: string;
  elapsed_s: number | null;
  strava_latency_s: number | null;
  strava_failure_stage: StravaFailureStage | "unknown" | null;
  /** The one provider detail safe to record: a status number carries no fault text. */
  strava_status: number | null;
  rate_limit_headers: StravaUsage | null;
  body_bytes: number | null;
  content_type: string | null;
  /** Present only when DEBUG_LOG_RAW_TEXT is enabled. Never a secret. */
  raw_text?: string;
}

export interface RequestState {
  requestId: string;
  dedupeKey: string | null;
  elapsedS: number | null;
  outcome: string;
  stravaLatencyS: number | null;
  stravaFailureStage: StravaFailureStage | "unknown" | null;
  stravaStatus: number | null;
  rateLimitHeaders: StravaUsage | null;
  authFailed: boolean;
  bodyBytes: number | null;
  contentType: string | null;
  rawText: string | null;
}

export function newRequestState(): RequestState {
  return {
    requestId: randomUUID(),
    dedupeKey: null,
    elapsedS: null,
    outcome: "internal_error",
    stravaLatencyS: null,
    stravaFailureStage: null,
    stravaStatus: null,
    rateLimitHeaders: null,
    authFailed: false,
    bodyBytes: null,
    contentType: null,
    rawText: null,
  };
}

export function toRequestLog(
  state: RequestState,
  includeRawText: boolean,
): RequestLog {
  const record: RequestLog = {
    request_id: state.requestId,
    dedupe_key: state.dedupeKey,
    outcome: state.outcome,
    elapsed_s: state.elapsedS,
    strava_latency_s: state.stravaLatencyS,
    strava_failure_stage: state.stravaFailureStage,
    strava_status: state.stravaStatus,
    rate_limit_headers: state.rateLimitHeaders,
    body_bytes: state.bodyBytes,
    content_type: state.contentType,
  };
  // Constraint 7 / ADR 0011: raw_text is loggable behind this flag; a secret never is.
  if (includeRawText && state.rawText !== null) {
    record.raw_text = state.rawText;
  }
  return record;
}

export function logRequest(record: RequestLog): void {
  console.log(JSON.stringify(record));
}

export function logAuthFailed(): void {
  // §11 permits no request metadata for a bad auth, only this counter line.
  console.log(JSON.stringify({ outcome: "auth_failed" }));
}

