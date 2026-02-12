# ClaudeWorker — MCP Server Design

## What Is This?

ClaudeWorker is a custom **Model Context Protocol (MCP) server** — a server you build
that gives AI models like Claude new tools and capabilities. Instead of Claude only
knowing what it was trained on, your MCP server lets it reach out and **do things**
in the real world: hit APIs, query databases, control devices, automate workflows.

---

## How MCP Works

```
┌─────────────────────┐
│   MCP Client        │  (Claude Code, Claude Desktop, VS Code, etc.)
│   (the AI host)     │
└────────┬────────────┘
         │  JSON-RPC over stdio or HTTP
         ▼
┌─────────────────────┐
│   ClaudeWorker      │  ← YOUR SERVER
│   (MCP Server)      │
│                     │
│  ┌───────────────┐  │
│  │ Tools         │  │  Functions the AI can call
│  │ Resources     │  │  Data the AI can read
│  │ Prompts       │  │  Templates the AI can use
│  └───────────────┘  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  External World     │  APIs, databases, file systems, hardware,
│                     │  web scraping, notifications, anything
└─────────────────────┘
```

### The Three Primitives

| Primitive    | What It Does                                    | Example                          |
|------------- |------------------------------------------------ |--------------------------------- |
| **Tools**    | Functions the AI can execute                    | `send_email`, `query_db`         |
| **Resources**| Read-only data the AI can access                | Config files, DB schemas, logs   |
| **Prompts**  | Reusable prompt templates                       | "Summarize this PR", "Write SQL" |

### Protocol Flow

1. **Discovery** — Client calls `tools/list` → Server returns available tools
2. **Invocation** — Client calls `tools/call` with tool name + arguments → Server runs the logic
3. **Response** — Server returns structured results back to the client

---

## Tech Stack

| Component        | Choice                         | Why                                      |
|----------------- |------------------------------- |----------------------------------------- |
| **Language**     | TypeScript                     | Best MCP SDK support, strong typing      |
| **MCP SDK**      | `@modelcontextprotocol/sdk`    | Official SDK from Anthropic              |
| **Runtime**      | Node.js (v18+)                 | Stable, widely supported                 |
| **Transport**    | stdio (local) / HTTP (remote)  | stdio for dev, HTTP for deployment       |
| **Package Mgr**  | npm                            | Standard, reliable                       |

---

## Project Structure

```
ClaudeWorker/
├── src/
│   ├── index.ts              # Server entry point — registers tools & starts server
│   ├── tools/                # Each tool in its own file
│   │   ├── example.ts        # Starter example tool
│   │   └── index.ts          # Tool registry (auto-discovers & exports all tools)
│   ├── resources/            # Resource definitions
│   │   └── index.ts
│   └── prompts/              # Prompt templates
│       └── index.ts
├── tests/
│   └── tools/                # Tests for each tool
├── package.json
├── tsconfig.json
├── DESIGN.md                 # ← You are here
└── README.md
```

---

## Tool Ideas — Pick Your Direction

Here are starter tool ideas. Pick one or more, or come up with your own:

### 1. Dev Workflow Tools
- `run_tests` — Run test suites and return results
- `lint_code` — Lint files and return issues
- `scaffold_project` — Generate boilerplate for new projects
- `search_docs` — Search documentation sites

### 2. Data & API Tools
- `query_database` — Run SQL queries against a database
- `fetch_api` — Make HTTP requests to any REST API
- `parse_csv` — Read and analyze CSV/Excel files
- `transform_json` — Reshape JSON data

### 3. Productivity Tools
- `send_notification` — Push notifications (Slack, Discord, email)
- `manage_todos` — CRUD operations on a task list
- `take_screenshot` — Capture screenshots of URLs
- `summarize_url` — Fetch and summarize any webpage

### 4. System & Ops Tools
- `system_health` — Check CPU, memory, disk usage
- `docker_manage` — List/start/stop Docker containers
- `port_scan` — Check what's running on local ports
- `log_analyzer` — Parse and summarize log files

### 5. Creative Tools
- `generate_image_prompt` — Build detailed image generation prompts
- `color_palette` — Generate color palettes from themes
- `ascii_art` — Convert text to ASCII art

---

## How a Tool Is Built (Example)

```typescript
// src/tools/example.ts
import { z } from "zod";

export const exampleTool = {
  name: "hello_world",
  description: "Says hello to someone. Use this to greet users.",
  inputSchema: z.object({
    name: z.string().describe("The name of the person to greet"),
  }),
  handler: async ({ name }: { name: string }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: `Hello, ${name}! Welcome to ClaudeWorker.`,
        },
      ],
    };
  },
};
```

---

## How to Connect It

### Claude Code (CLI)
```bash
# stdio transport (local)
claude mcp add claudeworker -- node /path/to/ClaudeWorker/dist/index.js

# HTTP transport (remote)
claude mcp add --transport http claudeworker http://localhost:3000/mcp
```

### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "claudeworker": {
      "command": "node",
      "args": ["/path/to/ClaudeWorker/dist/index.js"]
    }
  }
}
```

---

## Development Workflow

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Run locally (stdio mode for testing)
npm run dev

# 4. Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# 5. Connect to Claude Code
claude mcp add claudeworker -- node dist/index.js
```

---

## Next Steps

1. **Pick your tools** — Decide which tools to build first
2. **Scaffold the project** — Set up package.json, tsconfig, install SDK
3. **Build tool #1** — Start with one tool, get it working end-to-end
4. **Test with MCP Inspector** — Verify tools work before connecting to Claude
5. **Connect to Claude** — Wire it up and watch Claude use your tools

---

## References

- [Official MCP Docs — Build a Server](https://modelcontextprotocol.io/quickstart/server)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/servers)
- [Claude Code MCP Setup](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers)
- [Building Remote MCP Servers](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers)
