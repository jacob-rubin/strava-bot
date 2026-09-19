export function requestText(body: unknown, contentType: string | null): string {
  if (typeof body !== "string") {
    return "";
  }
  if (contentType === null || !contentType.toLowerCase().startsWith("application/json")) {
    return body;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "text" in parsed &&
      typeof parsed.text === "string"
    ) {
      return parsed.text;
    }
  } catch {
    // Constraint 6: an invalid JSON body is persisted as unparseable text, not rejected.
  }
  return body;
}
