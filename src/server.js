import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpServer.js";

// Local entry point: Claude Code (or any MCP client) launches this as a
// subprocess and talks to it over stdin/stdout. For remote/cloud deployment
// use src/httpServer.js instead.
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
