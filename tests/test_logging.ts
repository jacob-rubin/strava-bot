import { afterEach, describe, expect, it, vi } from "vitest";

import { logRequest } from "../app/logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRequest", () => {
  it("writes the status and the payload as one JSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logRequest({ status: 200, raw_text: "Deadlift day" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('{"status":200,"raw_text":"Deadlift day"}');
  });

  it("omits an absent payload instead of serialising it as null", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logRequest({ status: 404 });

    expect(spy).toHaveBeenCalledWith('{"status":404}');
  });
});
