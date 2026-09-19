import { createHash } from "node:crypto";

export function rawTextHash(rawText: string): string {
  return `sha256:${createHash("sha256")
    .update(rawText, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

export function secondsSince(startedAt: number): number {
  return Math.round(Date.now() - startedAt) / 1000;
}
