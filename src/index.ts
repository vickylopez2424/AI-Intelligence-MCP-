import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerDevTools } from "./tools/dev-workflow.js";
import { registerDataTools } from "./tools/data-api.js";
import { registerProductivityTools } from "./tools/productivity.js";
import { registerSystemTools } from "./tools/system-ops.js";

const server = new McpServer({
  name: "ClaudeWorker",
  version: "1.0.0",
});

// Register all tool categories
registerDevTools(server);
registerDataTools(server);
registerProductivityTools(server);
registerSystemTools(server);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ClaudeWorker MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
