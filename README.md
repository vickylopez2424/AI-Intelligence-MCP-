# ClaudeWorker

A custom MCP (Model Context Protocol) server that gives Claude new tools — dev workflows, API access, productivity, and system ops.

## Tools (14 total)

**Dev Workflow** — `run_tests`, `lint_code`, `scaffold_project`, `search_docs`

**Data & API** — `fetch_api`, `parse_csv`, `transform_json`

**Productivity** — `manage_todos`, `summarize_url`, `send_notification`

**System & Ops** — `system_health`, `docker_manage`, `port_scan`, `log_analyzer`

## Setup

```bash
npm install
npm run build
```

## Connect to Claude Code

```bash
claude mcp add claudeworker -- node /path/to/ClaudeWorker/dist/index.js
```

## Connect to Claude Desktop

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

## Test with MCP Inspector

```bash
npm run inspect
```
