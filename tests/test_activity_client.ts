import { describe, expect, it } from "vitest";

import { unavailableActivityClient } from "../app/ports/activity_client.js";

describe("unavailableActivityClient", () => {
  it("rejects instead of silently dropping a post", async () => {
    await expect(
      unavailableActivityClient().uploadActivity(
        { name: "Deadlift day", description: "", elapsed_time: 3600 },
        {
          start_time_utc: "2026-09-09T11:43:00Z",
          utc_offset: -18_000,
          exercises: [],
        },
      ),
    ).rejects.toThrow("No Strava client was supplied to the app factory.");
  });
});
