import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline/promises";

import { loadSettings } from "../app/config.js";

const REDIRECT_URI = "http://localhost/exchange_token";
const AUTHORIZE_ENDPOINT = "https://www.strava.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://www.strava.com/oauth/token";

interface AuthorizationTokenResponse {
  refresh_token?: unknown;
}

function buildAuthorizeUrl(clientId: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.search = [
    `client_id=${encodeURIComponent(clientId)}`,
    "response_type=code",
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    "approval_prompt=force",
    "scope=activity:write",
  ].join("&");
  return url.toString();
}

function extractCode(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Missing authorization code.");
  }

  if (!trimmed.includes("://")) {
    return trimmed;
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
  return code;
}

async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
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
  return payload.refresh_token;
}

async function main(): Promise<void> {
  loadEnvFile();
  const settings = loadSettings();
  const authorizeUrl = buildAuthorizeUrl(settings.stravaClientId);

  console.log(authorizeUrl);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let code: string;
  try {
    code = extractCode(await prompt.question("Paste the redirect URL or code: "));
  } finally {
    prompt.close();
  }

  const clientSecret = await settings.getStravaClientSecret();
  const refreshToken = await exchangeCode(
    settings.stravaClientId,
    clientSecret,
    code,
  );
  await settings.addStravaRefreshTokenVersion(refreshToken);
  console.log("Authorization succeeded; STRAVA_REFRESH_TOKEN version added.");
}

main().catch(() => {
  console.error("Authorization failed.");
  process.exitCode = 1;
});
