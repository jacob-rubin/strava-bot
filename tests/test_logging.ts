import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logAuthFailed,
  logRequest,
  newRequestState,
  toRequestLog,
} from "../app/logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("newRequestState", () => {
  it("starts as an internal error with a unique request id", () => {
    const first = newRequestState();
    const second = newRequestState();

    expect(first.outcome).toBe("internal_error");
    expect(first.authFailed).toBe(false);
    expect(first.rawText).toBeNull();
    expect(first.requestId).not.toBe(second.requestId);
  });
});

describe("toRequestLog", () => {
  it("maps camelCase state onto the persisted snake_case record", () => {
    const state = newRequestState();
    state.dedupeKey = "key";
    state.outcome = "posted";
    state.elapsedS = 3600;
    state.stravaStatus = 201;
    state.bodyBytes = 42;

    expect(toRequestLog(state, false)).toMatchObject({
      request_id: state.requestId,
      dedupe_key: "key",
      outcome: "posted",
      elapsed_s: 3600,
      strava_status: 201,
      body_bytes: 42,
    });
  });

  it("includes raw_text only when the flag and the text are both present", () => {
    const state = newRequestState();
    state.rawText = "Deadlift day";

    expect(toRequestLog(state, true).raw_text).toBe("Deadlift day");
    expect(toRequestLog(state, false).raw_text).toBeUndefined();
  });

  it("omits raw_text when the flag is on but nothing was captured", () => {
    expect(toRequestLog(newRequestState(), true).raw_text).toBeUndefined();
  });
});

describe("logAuthFailed", () => {
  it("writes a bare counter line carrying no request metadata", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuthFailed();

    expect(spy).toHaveBeenCalledWith(JSON.stringify({ outcome: "auth_failed" }));
  });
});

describe("logRequest", () => {
  it("writes the record as one JSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const record = toRequestLog(newRequestState(), false);

    logRequest(record);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(record));
  });
});
