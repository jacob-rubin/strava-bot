import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  loadSettings,
  type SecretManagerClient,
} from "../app/config.js";

const SECRET_VALUES = {
  "strava-bot-ingest-key": "ingest-secret-value",
  "strava-bot-path-token": "path-secret-value",
  "strava-client-secret": "client-secret-value",
  "strava-refresh-token": "refresh-secret-value",
  "llm-api-key": "llm-secret-value",
} as const;

type SecretId = keyof typeof SECRET_VALUES;

function createClientStub() {
  return {
    getProjectId: vi.fn(async () => "test-project"),
    accessSecretVersion: vi.fn(async ({ name }: { name: string }) => {
      const match = /\/secrets\/([^/]+)\/versions\/latest$/.exec(name);
      const secretId = match?.[1] as SecretId | undefined;
      if (secretId === undefined || !(secretId in SECRET_VALUES)) {
        throw new Error("Unknown test secret.");
      }
      return [
        { payload: { data: Buffer.from(SECRET_VALUES[secretId]) } },
      ] as const;
    }),
    addSecretVersion: vi.fn(
      async (_request: {
        parent: string;
        payload: { data: Uint8Array };
      }) => [{}] as const,
    ),
  } satisfies SecretManagerClient;
}

describe("loadSettings", () => {
  it("applies all four documented defaults", () => {
    const settings = loadSettings({
      env: { STRAVA_CLIENT_ID: "278290" },
      secretClient: createClientStub(),
    });

    expect(settings.localTz).toBe("America/Chicago");
    expect(settings.stravaUseStructuredUpload).toBe(false);
    expect(settings.maxBodyBytes).toBe(65_536);
    expect(settings.elapsedCapS).toBe(14_400);
  });

  it("loads environment-sourced settings", () => {
    const settings = loadSettings({
      env: {
        STRAVA_CLIENT_ID: "278290",
        LOCAL_TZ: "UTC",
        STRAVA_USE_STRUCTURED_UPLOAD: "true",
        MAX_BODY_BYTES: "1024",
        ELAPSED_CAP_S: "7200",
      },
      secretClient: createClientStub(),
    });

    expect(settings.stravaClientId).toBe("278290");
    expect(settings.localTz).toBe("UTC");
    expect(settings.stravaUseStructuredUpload).toBe(true);
    expect(settings.maxBodyBytes).toBe(1024);
    expect(settings.elapsedCapS).toBe(7200);
  });

  it("loads every secret through one cached Secret Manager seam", async () => {
    const client = createClientStub();
    const settings = loadSettings({
      env: { STRAVA_CLIENT_ID: "278290" },
      secretClient: client,
    });

    await expect(settings.getIngestKey()).resolves.toBe(
      SECRET_VALUES["strava-bot-ingest-key"],
    );
    await expect(settings.getIngestPathToken()).resolves.toBe(
      SECRET_VALUES["strava-bot-path-token"],
    );
    await expect(settings.getStravaClientSecret()).resolves.toBe(
      SECRET_VALUES["strava-client-secret"],
    );
    await expect(settings.getStravaRefreshToken()).resolves.toBe(
      SECRET_VALUES["strava-refresh-token"],
    );
    await expect(settings.getLlmApiKey()).resolves.toBe(
      SECRET_VALUES["llm-api-key"],
    );
    await settings.getIngestKey();

    expect(client.getProjectId).toHaveBeenCalledTimes(1);
    expect(client.accessSecretVersion).toHaveBeenCalledTimes(5);
    expect(client.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/test-project/secrets/strava-bot-ingest-key/versions/latest",
    });
  });

  it("writes and updates the cached refresh token", async () => {
    const client = createClientStub();
    const settings = loadSettings({
      env: { STRAVA_CLIENT_ID: "278290" },
      secretClient: client,
    });

    await settings.addStravaRefreshTokenVersion("rotated-secret-value");

    expect(client.addSecretVersion).toHaveBeenCalledOnce();
    const request = client.addSecretVersion.mock.calls[0]?.[0] as {
      parent: string;
      payload: { data: Uint8Array };
    };
    expect(request.parent).toBe(
      "projects/test-project/secrets/strava-refresh-token",
    );
    expect(Buffer.from(request.payload.data).toString("utf8")).toBe(
      "rotated-secret-value",
    );
    await expect(settings.getStravaRefreshToken()).resolves.toBe(
      "rotated-secret-value",
    );
    expect(client.accessSecretVersion).not.toHaveBeenCalled();
  });

  it("never includes secret values in JSON or string serialization", async () => {
    const settings = loadSettings({
      env: { STRAVA_CLIENT_ID: "278290" },
      secretClient: createClientStub(),
    });
    const secretValues = await Promise.all([
      settings.getIngestKey(),
      settings.getIngestPathToken(),
      settings.getStravaClientSecret(),
      settings.getStravaRefreshToken(),
      settings.getLlmApiKey(),
    ]);

    const serialized = `${JSON.stringify(settings)} ${String(settings)}`;
    for (const secretValue of secretValues) {
      expect(serialized).not.toContain(secretValue);
    }
  });

  it("does not expose a secret value from a client exception", async () => {
    const client = createClientStub();
    const leakedValue = SECRET_VALUES["strava-client-secret"];
    client.accessSecretVersion.mockRejectedValueOnce(
      new Error(`upstream error containing ${leakedValue}`),
    );
    const settings = loadSettings({
      env: { STRAVA_CLIENT_ID: "278290" },
      secretClient: client,
    });

    const error = await settings.getStravaClientSecret().catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(leakedValue);
  });
});
