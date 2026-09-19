import { loadSettings, type Settings } from "../config.js";

export interface IngestSettings {
  readonly localTz: string;
  readonly maxBodyBytes: number;
  readonly elapsedCapS: number;
  getIngestKey(): Promise<string>;
  getIngestPathToken(): Promise<string>;
}

export interface ResolvedSettings {
  readonly settings: IngestSettings;
  readonly runtimeSettings: Settings | null;
}

export function resolveSettings(
  injected: IngestSettings | undefined,
): ResolvedSettings {
  if (injected !== undefined) {
    return { settings: injected, runtimeSettings: null };
  }
  const loaded = loadSettings();
  return { settings: loaded, runtimeSettings: loaded };
}

