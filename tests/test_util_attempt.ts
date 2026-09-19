import { describe, expect, it } from "vitest";

import { attempt, attemptSync } from "../app/util/attempt.js";

describe("attempt", () => {
  it("wraps a resolved value", async () => {
    expect(await attempt(async () => 3)).toEqual({ ok: true, value: 3 });
  });

  it("captures a rejection instead of throwing", async () => {
    const error = new Error("boom");
    expect(
      await attempt(async () => {
        throw error;
      }),
    ).toEqual({ ok: false, error });
  });

  it("captures a throw raised before the promise is returned", async () => {
    const error = new Error("sync boom");
    expect(
      await attempt(() => {
        throw error;
      }),
    ).toEqual({ ok: false, error });
  });
});

describe("attemptSync", () => {
  it("wraps a returned value", () => {
    expect(attemptSync(() => "ok")).toEqual({ ok: true, value: "ok" });
  });

  it("captures a thrown error", () => {
    const error = new Error("boom");
    expect(
      attemptSync(() => {
        throw error;
      }),
    ).toEqual({ ok: false, error });
  });

  it("preserves a non-Error throw", () => {
    expect(
      attemptSync(() => {
        throw "plain string";
      }),
    ).toEqual({ ok: false, error: "plain string" });
  });
});

