import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";

function tokenStorePath() {
  return (
    process.env.BAIDU_TOKEN_STORE ||
    path.join(os.homedir(), ".baidu-netdisk-mcp", "tokens.json")
  );
}

export function loadTokens() {
  const file = tokenStorePath();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveTokens(tokens) {
  const file = tokenStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

function appCreds() {
  const client_id = process.env.BAIDU_APP_KEY;
  const client_secret = process.env.BAIDU_SECRET_KEY;
  if (!client_id || !client_secret) {
    throw new Error(
      "BAIDU_APP_KEY / BAIDU_SECRET_KEY not set (check your .env / MCP server env config)"
    );
  }
  return { client_id, client_secret };
}

async function refreshAccessToken(refresh_token) {
  const { client_id, client_secret } = appCreds();
  const url = new URL(OAUTH_TOKEN_URL);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refresh_token);
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("client_secret", client_secret);

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(
      `Failed to refresh Baidu access token: ${data.error} - ${data.error_description || ""}`
    );
  }
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refresh_token,
    obtained_at: Date.now(),
    expires_in: data.expires_in,
  };
  saveTokens(tokens);
  return tokens;
}

/** Returns a currently-valid access_token, refreshing it if it is close to expiry. */
export async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      "No stored Baidu tokens found. Run `npm run authorize` once to authorize this app."
    );
  }
  const ageSeconds = (Date.now() - tokens.obtained_at) / 1000;
  const marginSeconds = 300; // refresh 5 min before real expiry
  if (ageSeconds < tokens.expires_in - marginSeconds) {
    return tokens.access_token;
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return refreshed.access_token;
}
