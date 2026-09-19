import { describe, expect, it } from "vitest";

import { contentLengthHeader, headerValue } from "../app/util/http_headers.js";

describe("headerValue", () => {
  it("returns a single header value", () => {
    expect(headerValue("text/plain")).toBe("text/plain");
  });

  it("preserves an absent or repeated header as absence", () => {
    expect(headerValue(undefined)).toBeNull();
    expect(headerValue(["first", "second"])).toBeNull();
  });
});

describe("contentLengthHeader", () => {
  it("accepts a safe integer header", () => {
    expect(contentLengthHeader("65536")).toBe(65_536);
  });

  it("rejects absent, repeated, non-numeric, and unsafe headers", () => {
    expect(contentLengthHeader(undefined)).toBeNull();
    expect(contentLengthHeader(["12"])).toBeNull();
    expect(contentLengthHeader("12.5")).toBeNull();
    expect(contentLengthHeader("9007199254740992")).toBeNull();
  });
});
