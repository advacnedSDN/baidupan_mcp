import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcpServer.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error(
    "MCP_AUTH_TOKEN is not set. Refusing to start an unauthenticated remote MCP server.\n" +
      "Set MCP_AUTH_TOKEN in your .env to a long random secret first."
  );
  process.exit(1);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || !timingSafeEqual(token, AUTH_TOKEN)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
}

const app = express();
app.use(express.json());

// Stateless mode: a fresh McpServer + transport per request. Simple and
// fine for a single-user personal deployment with no server push needed.
app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Streamable HTTP also defines GET (server->client stream) and DELETE
// (session teardown); neither applies in stateless mode.
app.get("/mcp", requireAuth, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)" },
    id: null,
  });
});
app.delete("/mcp", requireAuth, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)" },
    id: null,
  });
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, HOST, () => {
  console.log(`baidu-netdisk-mcp listening on http://${HOST}:${PORT}/mcp`);
  console.log(
    "Put this behind a TLS-terminating reverse proxy (Caddy/nginx) before exposing it publicly."
  );
});
