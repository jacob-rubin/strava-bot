import { createHash } from "node:crypto";

export function rawTextHash(rawText: string): string {
  return `sha256:${createHash("sha256")
    .update(rawText, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}
