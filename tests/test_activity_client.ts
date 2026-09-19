import { describe, expect, it } from "vitest";

import { unavailableActivityClient } from "../app/ports/activity_client.js";

describe("unavailableActivityClient", () => {
  it("rejects instead of silently dropping a post", async () => {
    await expect(
      unavailableActivityClient().createActivity({
        name: "Deadlift day",
        description: "",
        start_date_local: "2026-09-09T06:43:00",
        elapsed_time: 3600,
      }),
    ).rejects.toThrow("No Strava client was supplied to the app factory.");
  });
});
