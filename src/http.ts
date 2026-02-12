import { createServer, IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { registerAllTools } from "./register.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEYS = (process.env.API_KEYS || "").split(",").filter(Boolean);
const AUTH_ENABLED = API_KEYS.length > 0;

// --- Auth middleware ---
function authenticate(req: IncomingMessage): boolean {
  if (!AUTH_ENABLED) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const [scheme, key] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return false;

  return API_KEYS.includes(key);
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

// --- Server setup ---
const transports: Map<string, SSEServerTransport> = new Map();

const httpServer = createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      server: "AI-Intelligence-MCP",
      version: "1.0.0",
      auth: AUTH_ENABLED ? "enabled" : "disabled",
    }));
    return;
  }

  // Auth check for MCP endpoints
  if (req.url?.startsWith("/sse") || req.url?.startsWith("/messages")) {
    if (!authenticate(req)) {
      sendError(res, 401, "Unauthorized. Provide a valid API key via Authorization: Bearer <key>");
      return;
    }
  }

  // SSE endpoint — client connects here for MCP
  if (req.url === "/sse") {
    const server = new McpServer({
      name: "AI-Intelligence-MCP",
      version: "1.0.0",
    });

    registerAllTools(server);

    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);

    res.on("close", () => {
      transports.delete(transport.sessionId);
    });

    await server.connect(transport);
    return;
  }

  // Messages endpoint — client sends tool calls here
  if (req.url?.startsWith("/messages")) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId || !transports.has(sessionId)) {
      sendError(res, 400, "Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handlePostMessage(req, res);
    return;
  }

  // Info page
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "AI Intelligence MCP",
      version: "1.0.0",
      description: "Custom MCP server with 28+ tools across 8 categories",
      endpoints: {
        "/health": "Health check",
        "/sse": "SSE MCP connection (GET)",
        "/messages": "MCP message handler (POST)",
      },
      auth: AUTH_ENABLED
        ? "API key required. Set Authorization: Bearer <key>"
        : "No auth required. Set API_KEYS env var to enable.",
    }));
    return;
  }

  sendError(res, 404, "Not found");
});

httpServer.listen(PORT, () => {
  console.error(`AI Intelligence MCP server running on http://localhost:${PORT}`);
  console.error(`Auth: ${AUTH_ENABLED ? "enabled" : "disabled (set API_KEYS to enable)"}`);
  console.error(`Connect: claude mcp add --transport sse ai-intelligence-mcp http://localhost:${PORT}/sse`);
});
