#!/usr/bin/env node
// One-time OAuth authorization using Baidu's device-code flow, so this
// never needs a redirect_uri or a local web server.
//
// Docs: https://pan.baidu.com/union  (百度网盘开放平台) -> OAuth/授权机制
import "dotenv/config";
import { saveTokens } from "../src/auth.js";

const DEVICE_CODE_URL = "https://openapi.baidu.com/oauth/2.0/device/code";
const TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
const SCOPE = "basic,netdisk";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in first.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const client_id = requireEnv("BAIDU_APP_KEY");
  const client_secret = requireEnv("BAIDU_SECRET_KEY");

  const codeUrl = new URL(DEVICE_CODE_URL);
  codeUrl.searchParams.set("response_type", "device_code");
  codeUrl.searchParams.set("client_id", client_id);
  codeUrl.searchParams.set("scope", SCOPE);

  const codeRes = await fetch(codeUrl);
  const codeData = await codeRes.json();
  if (codeData.error) {
    console.error("Failed to get device code:", codeData);
    process.exit(1);
  }

  console.log("\n1. Open this URL on any device and log in to your Baidu account:");
  console.log(`   ${codeData.verification_url}`);
  console.log(`2. Enter this code when prompted: ${codeData.user_code}`);
  console.log(`\nWaiting for authorization (expires in ${codeData.expires_in}s)...\n`);

  const intervalMs = (codeData.interval || 5) * 1000;
  const deadline = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const tokenUrl = new URL(TOKEN_URL);
    tokenUrl.searchParams.set("grant_type", "device_token");
    tokenUrl.searchParams.set("code", codeData.device_code);
    tokenUrl.searchParams.set("client_id", client_id);
    tokenUrl.searchParams.set("client_secret", client_secret);

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      saveTokens({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        obtained_at: Date.now(),
        expires_in: tokenData.expires_in,
      });
      console.log("Authorized. Tokens saved — the MCP server can now use the API.");
      return;
    }

    // authorization_pending is expected while the user hasn't approved yet.
    if (tokenData.error && tokenData.error !== "authorization_pending") {
      console.error("Authorization failed:", tokenData);
      process.exit(1);
    }
  }

  console.error("Timed out waiting for authorization. Run this script again.");
  process.exit(1);
}

main();
