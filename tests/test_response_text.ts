import { describe, expect, it } from "vitest";

import {
  alreadyPostedResponse,
  postedResponse,
} from "../app/ingest/response_text.js";
import {
  InternalError,
  StravaRejectedError,
  stravaReason,
} from "../app/ingest/error.js";

describe("ingest response text", () => {
  it("strips the URL protocol and falls back when Strava has no URL", () => {
    expect(alreadyPostedResponse("https://www.strava.com/activities/123")).toBe(
      "already posted: strava.com/activities/123",
    );
    expect(alreadyPostedResponse(null)).toBe("already posted: Strava activity");
  });

  it("returns the complete posted response", () => {
    expect(postedResponse("x".repeat(201), null)).toHaveLength(227);
  });

  it("sanitizes Strava error messages before persisting or responding", () => {
    const error = new Error("first line\r\nsecond line");

    expect(stravaReason(error)).toBe("first line second line");
    expect(new StravaRejectedError(error)).toMatchObject({
      message: "strava rejected: first line second line",
      statusCode: 502,
    });
    expect(stravaReason({})).toBe("Strava request failed");
  });

  it("includes the request id in an internal error", () => {
    expect(new InternalError("request-123")).toMatchObject({
      message: "internal error: request-123",
      statusCode: 500,
    });
  });
});
