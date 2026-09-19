import { describe, expect, it } from "vitest";

import { safeSecretEqual } from "../app/util/secret_comparison.js";

describe("safeSecretEqual", () => {
  it("accepts matching secrets", () => {
    expect(safeSecretEqual("ingest-key", "ingest-key")).toBe(true);
  });

  it("rejects non-matching and absent secrets", () => {
    expect(safeSecretEqual("wrong-key", "ingest-key")).toBe(false);
    expect(safeSecretEqual(null, "ingest-key")).toBe(false);
  });
});
