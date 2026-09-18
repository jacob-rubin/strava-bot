import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { loadSettings } from "../app/config.js";

const REDIRECT_URI = "http://localhost/exchange_token";
const AUTHORIZE_ENDPOINT = "https://www.strava.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://www.strava.com/oauth/token";

/**
 * CONSTRAINTS rule 2: request `activity:write` and nothing broader. Strava may
 * additionally grant `read`, which is accepted. A grant that omits
 * `activity:write` is useless to this service — the refresh token works, but
 * every create-activity call comes back as an authorization error — so it is
 * rejected here instead of being written to Secret Manager.
 */
const REQUIRED_SCOPE = "activity:write";

interface AuthorizationTokenResponse {
  refresh_token?: unknown;
  scope?: unknown;
}

/**
 * An error whose message was authored in this file and is therefore safe to
 * print. Every other failure stays generic so no secret can reach stderr
 * (CONSTRAINTS rule 7).
 */
class AuthorizationError extends Error {}

interface Grant {
  code: string;
  /** Scopes reported by the redirect, or null when a bare code was pasted. */
  scopes: string[] | null;
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function assertWriteScope(scopes: string[], source: string): void {
  if (scopes.includes(REQUIRED_SCOPE)) {
    return;
  }
  const granted = scopes.length > 0 ? scopes.join(", ") : "nothing";
  throw new AuthorizationError(
    `Strava granted ${granted} (per the ${source}), but ${REQUIRED_SCOPE} is required.\n` +
      'Re-run this script and tick "Upload your activities to Strava" on the consent screen.\n' +
      "No refresh token was saved.",
  );
}

function buildAuthorizeUrl(clientId: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.search = [
    `client_id=${encodeURIComponent(clientId)}`,
    "response_type=code",
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    "approval_prompt=force",
    `scope=${REQUIRED_SCOPE}`,
  ].join("&");
  return url.toString();
}

function extractGrant(input: string): Grant {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Missing authorization code.");
  }

  if (!trimmed.includes("://")) {
    return { code: trimmed, scopes: null };
  }

  const redirect = new URL(trimmed);
  if (
    redirect.origin !== "http://localhost" ||
    redirect.pathname !== "/exchange_token"
  ) {
    throw new Error("Unexpected redirect URL.");
  }

  const code = redirect.searchParams.get("code")?.trim();
  if (!code) {
    throw new Error("Redirect URL has no authorization code.");
  }
  return { code, scopes: parseScopes(redirect.searchParams.get("scope")) };
}

async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{ refreshToken: string; scopes: string[] }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error("Strava rejected the authorization exchange.");
  }

  const payload = (await response.json()) as AuthorizationTokenResponse;
  if (typeof payload.refresh_token !== "string" || payload.refresh_token.length === 0) {
    throw new Error("Strava returned no refresh token.");
  }
  return {
    refreshToken: payload.refresh_token,
    scopes: parseScopes(payload.scope),
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const settings = loadSettings();
  const authorizeUrl = buildAuthorizeUrl(settings.stravaClientId);

  console.log(authorizeUrl);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let grant: Grant;
  try {
    grant = extractGrant(await prompt.question("Paste the redirect URL or code: "));
  } finally {
    prompt.close();
  }

  // Check the redirect's own scope list first: this runs before the code is
  // exchanged, so a partial grant fails without burning the authorization code.
  if (grant.scopes !== null) {
    assertWriteScope(grant.scopes, "redirect URL");
  }

  const clientSecret = await settings.getStravaClientSecret();
  const { refreshToken, scopes } = await exchangeCode(
    settings.stravaClientId,
    clientSecret,
    grant.code,
  );

  // Re-check against the token response, which is authoritative. When a bare
  // code was pasted this is the only scope evidence available; if Strava
  // reported none, refuse rather than save a token of unknown scope.
  if (scopes.length > 0) {
    assertWriteScope(scopes, "token response");
  } else if (grant.scopes === null) {
    throw new AuthorizationError(
      "Strava reported no granted scope, so it cannot be verified.\n" +
        "Re-run this script and paste the full redirect URL rather than just the code.\n" +
        "No refresh token was saved.",
    );
  }

  await settings.addStravaRefreshTokenVersion(refreshToken);
  const verified = scopes.length > 0 ? scopes : (grant.scopes ?? []);
  console.log(
    `Authorization succeeded with scope ${verified.join(", ")};` +
      " STRAVA_REFRESH_TOKEN version added.",
  );
}

// Run only when invoked directly, so the scope helpers above can be imported
// by tests without triggering the interactive flow.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    // Only messages authored in this file are printed; anything else could in
    // principle carry a credential, so it stays generic (CONSTRAINTS rule 7).
    if (error instanceof AuthorizationError) {
      console.error(error.message);
    } else {
      console.error("Authorization failed.");
    }
    process.exitCode = 1;
  });
}

export {
  AuthorizationError,
  assertWriteScope,
  buildAuthorizeUrl,
  extractGrant,
  parseScopes,
  REQUIRED_SCOPE,
};
