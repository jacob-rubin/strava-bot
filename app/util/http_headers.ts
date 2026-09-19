type HeaderValue = string | readonly string[] | undefined;

export function headerValue(value: HeaderValue): string | null {
  return typeof value === "string" ? value : null;
}

export function contentLengthHeader(value: HeaderValue): number | null {
  const raw = headerValue(value);
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
