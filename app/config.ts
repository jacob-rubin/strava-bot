import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

type SecretName =
  | "INGEST_KEY"
  | "INGEST_PATH_TOKEN"
  | "STRAVA_CLIENT_SECRET"
  | "STRAVA_REFRESH_TOKEN";

interface SecretPayloadLike {
  data?: Uint8Array | string | null;
}

interface AccessSecretVersionResponseLike {
  payload?: SecretPayloadLike | null;
}

export interface SecretManagerClient {
  getProjectId(): Promise<string>;
  accessSecretVersion(request: {
    name: string;
  }): Promise<readonly [AccessSecretVersionResponseLike, ...unknown[]]>;
  addSecretVersion(request: {
    parent: string;
    payload: { data: Uint8Array };
  }): Promise<readonly [unknown, ...unknown[]]>;
}

const SECRET_IDS: Readonly<Record<SecretName, string>> = {
  INGEST_KEY: "strava-bot-ingest-key",
  INGEST_PATH_TOKEN: "strava-bot-path-token",
  STRAVA_CLIENT_SECRET: "strava-client-secret",
  STRAVA_REFRESH_TOKEN: "strava-refresh-token",
};

const DEFAULT_LOCAL_TZ = "America/Chicago";
const DEFAULT_MAX_BODY_BYTES = 65_536;
const DEFAULT_ELAPSED_CAP_S = 14_400;

export class SecretManagerSecretAccessor {
  readonly #client: SecretManagerClient;
  readonly #cache = new Map<SecretName, Promise<string>>();
  #projectId: Promise<string> | undefined;

  constructor(client: SecretManagerClient = new SecretManagerServiceClient()) {
    this.#client = client;
  }

  get(secretName: SecretName): Promise<string> {
    const cached = this.#cache.get(secretName);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.#read(secretName).catch((error: unknown) => {
      this.#cache.delete(secretName);
      throw error;
    });
    this.#cache.set(secretName, pending);
    return pending;
  }

  async addVersion(secretName: SecretName, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`Cannot add an empty version for ${secretName}.`);
    }

    try {
      const projectId = await this.#getProjectId();
      await this.#client.addSecretVersion({
        parent: `projects/${projectId}/secrets/${SECRET_IDS[secretName]}`,
        payload: { data: Buffer.from(value, "utf8") },
      });
    } catch {
      throw new Error(`Unable to add a version for ${secretName}.`);
    }
    this.#cache.set(secretName, Promise.resolve(value));
  }

  /**
   * Drop the cached value so the next `get` re-reads `versions/latest`.
   *
   * The cache is per process and otherwise lives as long as the instance, so
   * without this a container keeps using the secret version it first read.
   * That matters for STRAVA_REFRESH_TOKEN: Strava may rotate it (§7.3), and a
   * rotation persisted by one instance is invisible to every other instance.
   * It also means a re-authorization would not be picked up without a redeploy.
   */
  invalidate(secretName: SecretName): void {
    this.#cache.delete(secretName);
  }

  async #read(secretName: SecretName): Promise<string> {
    try {
      const projectId = await this.#getProjectId();
      const [response] = await this.#client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${SECRET_IDS[secretName]}/versions/latest`,
      });
      const data = response.payload?.data;

      if (data === undefined || data === null) {
        throw new Error("Missing payload.");
      }

      const value =
        typeof data === "string" ? data : Buffer.from(data).toString("utf8");
      if (value.length === 0) {
        throw new Error("Empty payload.");
      }

      return value;
    } catch {
      throw new Error(`Unable to access ${secretName}.`);
    }
  }

  #getProjectId(): Promise<string> {
    this.#projectId ??= this.#client.getProjectId();
    return this.#projectId;
  }
}

export type SettingsOptions = {
  env?: NodeJS.ProcessEnv;
  secretClient?: SecretManagerClient;
};

export class Settings {
  readonly stravaClientId: string;
  readonly localTz: string;
  readonly stravaUseStructuredUpload: boolean;
  readonly maxBodyBytes: number;
  readonly elapsedCapS: number;
  readonly #secrets: SecretManagerSecretAccessor;

  constructor(env: NodeJS.ProcessEnv, secrets: SecretManagerSecretAccessor) {
    this.stravaClientId = requiredEnv(env, "STRAVA_CLIENT_ID");
    this.localTz = env.LOCAL_TZ?.trim() || DEFAULT_LOCAL_TZ;
    this.stravaUseStructuredUpload = parseBoolean(
      env.STRAVA_USE_STRUCTURED_UPLOAD,
      "STRAVA_USE_STRUCTURED_UPLOAD",
      false,
    );
    this.maxBodyBytes = parsePositiveInteger(
      env.MAX_BODY_BYTES,
      "MAX_BODY_BYTES",
      DEFAULT_MAX_BODY_BYTES,
    );
    this.elapsedCapS = parsePositiveInteger(
      env.ELAPSED_CAP_S,
      "ELAPSED_CAP_S",
      DEFAULT_ELAPSED_CAP_S,
    );
    this.#secrets = secrets;
  }

  getIngestKey(): Promise<string> {
    return this.#secrets.get("INGEST_KEY");
  }

  getIngestPathToken(): Promise<string> {
    return this.#secrets.get("INGEST_PATH_TOKEN");
  }

  getStravaClientSecret(): Promise<string> {
    return this.#secrets.get("STRAVA_CLIENT_SECRET");
  }

  getStravaRefreshToken(): Promise<string> {
    return this.#secrets.get("STRAVA_REFRESH_TOKEN");
  }

  /**
   * Re-read STRAVA_REFRESH_TOKEN from Secret Manager, bypassing the cache.
   * Used after Strava rejects an access token, so an instance holding a stale
   * or superseded refresh token can recover without being replaced.
   */
  reloadStravaRefreshToken(): Promise<string> {
    this.#secrets.invalidate("STRAVA_REFRESH_TOKEN");
    return this.#secrets.get("STRAVA_REFRESH_TOKEN");
  }

  addStravaRefreshTokenVersion(value: string): Promise<void> {
    return this.#secrets.addVersion("STRAVA_REFRESH_TOKEN", value);
  }

  toJSON(): Record<string, boolean | number | string> {
    return {
      stravaClientId: this.stravaClientId,
      localTz: this.localTz,
      stravaUseStructuredUpload: this.stravaUseStructuredUpload,
      maxBodyBytes: this.maxBodyBytes,
      elapsedCapS: this.elapsedCapS,
    };
  }

  toString(): string {
    return "[Settings]";
  }
}

export function loadSettings(options: SettingsOptions = {}): Settings {
  const env = options.env ?? process.env;
  const secretClient = options.secretClient ?? new SecretManagerServiceClient();
  return new Settings(env, new SecretManagerSecretAccessor(secretClient));
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function parseBoolean(
  rawValue: string | undefined,
  name: string,
  defaultValue: boolean,
): boolean {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function parsePositiveInteger(
  rawValue: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
