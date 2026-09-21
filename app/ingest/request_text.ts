import { attemptSync } from "../util/attempt.js";

export function requestText(body: unknown, contentType: string | null): string {
  if (typeof body !== "string") {
    return "";
  }
  if (contentType === null || !contentType.toLowerCase().startsWith("application/json")) {
    return body;
  }
  // Constraint 6: an invalid JSON body is persisted as unparseable text, not rejected.
  const parsed = attemptSync((): unknown => JSON.parse(body));
  if (
    parsed.ok &&
    typeof parsed.value === "object" &&
    parsed.value !== null &&
    "text" in parsed.value &&
    typeof parsed.value.text === "string"
  ) {
    return parsed.value.text;
  }
  return body;
}
