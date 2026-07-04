#!/usr/bin/env node
/**
 * Polymarket MCP Server — Mock Authorization & Order Management.
 *
 * Provides tools for a simulated Polymarket trading flow:
 * authorize → place → cancel / query → revoke.
 * All state is in-memory, all markets are mock data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { InMemoryStore } from "./store/in-memory-store.js";
import { AuthService } from "./services/auth-service.js";
import { OrderService } from "./services/order-service.js";
import { registerAuthorizationTools } from "./tools/authorization-tools.js";
import { registerOrderTools } from "./tools/order-tools.js";

// ── Bootstrap ───────────────────────────────────────

const store = InMemoryStore.getInstance();
const authService = new AuthService(store);
const orderService = new OrderService(store, authService);

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

registerAuthorizationTools(server, authService);
registerOrderTools(server, orderService);

// ── Transport ───────────────────────────────────────

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running via stdio`);
}

async function runHTTP() {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
