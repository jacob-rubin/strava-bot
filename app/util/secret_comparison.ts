import { createHash, timingSafeEqual } from "node:crypto";

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function safeSecretEqual(supplied: string | null, expected: string): boolean {
  const suppliedValue = supplied === null ? "" : supplied;
  return timingSafeEqual(secretDigest(suppliedValue), secretDigest(expected));
}
