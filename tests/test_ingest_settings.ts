import { describe, expect, it } from "vitest";

import {
  resolveSettings,
  type IngestSettings,
} from "../app/ports/ingest_settings.js";

const injected: IngestSettings = {
  localTz: "America/Chicago",
  maxBodyBytes: 65536,
  elapsedCapS: 14400,
  getIngestKey: async () => "key",
  getIngestPathToken: async () => "token",
};

describe("resolveSettings", () => {
  it("passes injected settings through without loading the environment", () => {
    const resolved = resolveSettings(injected);

    expect(resolved.settings).toBe(injected);
    expect(resolved.runtimeSettings).toBeNull();
  });
});
