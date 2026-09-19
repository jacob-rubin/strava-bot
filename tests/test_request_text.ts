import { describe, expect, it } from "vitest";

import { requestText } from "../app/ingest/request_text.js";

describe("requestText", () => {
  it("keeps plain text verbatim", () => {
    expect(requestText("Deadlift day", "text/plain; charset=utf-8")).toBe("Deadlift day");
  });

  it("extracts the supported JSON text field", () => {
    expect(requestText('{"text":"Deadlift day"}', "application/json")).toBe("Deadlift day");
  });

  it("retains malformed and unsupported JSON bodies", () => {
    expect(requestText("{", "application/json")).toBe("{");
    expect(requestText('{"text":3}', "application/json")).toBe('{"text":3}');
  });

  it("retains the established empty fallback for a non-string parsed body", () => {
    expect(requestText({ text: "Deadlift day" }, "application/json")).toBe("");
  });
});
