import { loadSettings } from "./config.js";
import { logRequest } from "./logging.js";
import { createApp } from "./main.js";
import { defaultStravaClient } from "./ports/activity_client.js";
import { defaultStore } from "./ports/workout_store_like.js";

const settings = loadSettings();
const app = createApp({
  settings,
  store: defaultStore(),
  strava: defaultStravaClient(settings),
  log: logRequest,
});
void app
  .listen({
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 8080),
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
