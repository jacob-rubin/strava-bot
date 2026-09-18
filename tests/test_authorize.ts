import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  assertWriteScope,
  buildAuthorizeUrl,
  extractGrant,
  parseScopes,
  REQUIRED_SCOPE,
} from "../scripts/authorize.js";

const REDIRECT = "http://localhost/exchange_token?state=&code=abc123";

describe("authorize scope guard", () => {
  it("asks for activity:write and nothing broader (constraint 2)", () => {
    const url = new URL(buildAuthorizeUrl("278290"));
    expect(url.searchParams.get("scope")).toBe("activity:write");
  });

  it("accepts a grant that includes activity:write", () => {
    expect(() => assertWriteScope(["activity:write"], "redirect URL")).not.toThrow();
  });

  it("accepts read alongside activity:write, which Strava may add", () => {
    expect(() =>
      assertWriteScope(["read", "activity:write"], "redirect URL"),
    ).not.toThrow();
  });

  it("rejects a read-only grant, the failure that caused the outage", () => {
    expect(() => assertWriteScope(["read"], "redirect URL")).toThrow(AuthorizationError);
  });

  it("rejects an empty grant", () => {
    expect(() => assertWriteScope([], "token response")).toThrow(AuthorizationError);
  });

  it("explains how to fix a partial grant without naming a secret", () => {
    let message = "";
    try {
      assertWriteScope(["read"], "redirect URL");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain(REQUIRED_SCOPE);
    expect(message).toContain("Upload your activities to Strava");
    expect(message).toContain("No refresh token was saved.");
  });

  it("parses Strava's comma-separated scope list", () => {
    expect(parseScopes("read,activity:write")).toEqual(["read", "activity:write"]);
    expect(parseScopes("read, activity:write ")).toEqual(["read", "activity:write"]);
    expect(parseScopes("")).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it("reads the granted scope out of a redirect URL", () => {
    const grant = extractGrant(`${REDIRECT}&scope=read,activity:write`);
    expect(grant.code).toBe("abc123");
    expect(grant.scopes).toEqual(["read", "activity:write"]);
  });

  it("reports an empty scope list when the redirect omits scope", () => {
    expect(extractGrant(REDIRECT).scopes).toEqual([]);
  });

  it("reports unknown scope for a bare pasted code", () => {
    const grant = extractGrant("  abc123  ");
    expect(grant.code).toBe("abc123");
    expect(grant.scopes).toBeNull();
  });

  it("refuses a redirect that is not the expected callback", () => {
    expect(() => extractGrant("https://evil.example/exchange_token?code=abc")).toThrow();
  });
});
