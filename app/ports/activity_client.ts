import type { Settings } from "../config.js";
import {
  StravaClient,
  type CreateActivityInput,
  type CreateActivityResult,
  type StravaSettings,
  type StructuredWorkoutInput,
} from "../strava.js";

export interface ActivityClient {
  createActivity(
    activity: CreateActivityInput,
    structuredWorkout?: StructuredWorkoutInput,
  ): Promise<CreateActivityResult>;
}

export function defaultStravaClient(settings: Settings): StravaClient {
  const stravaSettings: StravaSettings = {
    getStravaClientId: async () => settings.stravaClientId,
    getStravaClientSecret: () => settings.getStravaClientSecret(),
    getStravaRefreshToken: () => settings.getStravaRefreshToken(),
    reloadStravaRefreshToken: () => settings.reloadStravaRefreshToken(),
    addStravaRefreshTokenVersion: (value) =>
      settings.addStravaRefreshTokenVersion(value),
  };
  // Plain-text lines, not RequestLog records, so the one-record-per-request invariant
  // holds; without them a 401 the client silently refreshed past stays invisible.
  return new StravaClient({
    settings: stravaSettings,
    log: (line) => console.log(line),
    useStructuredUpload: settings.stravaUseStructuredUpload,
  });
}

export function unavailableActivityClient(): ActivityClient {
  return {
    async createActivity(): Promise<CreateActivityResult> {
      throw new Error("No Strava client was supplied to the app factory.");
    },
  };
}

