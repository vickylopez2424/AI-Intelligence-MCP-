# AI Intelligence MCP

A premium MCP (Model Context Protocol) server with 28+ tools across 8 categories. Gives Claude (and any MCP client) new capabilities — dev workflows, databases, Git, system ops, creative tools, and more.

## Tools (28 total)

### Free Tier
| Tool | Description |
|------|-------------|
| `system_health` | CPU, memory, disk, uptime |
| `port_scan` | Check listening ports |
| `ascii_art` | Convert text to block art |
| `manage_todos` | Persistent todo list |
| `search_docs` | Grep across a project |
| `git_status` | Full repo status |
| `git_log` | Commit history with filters |
| `color_palette` | Generate color palettes |

### Pro Tier
| Tool | Description |
|------|-------------|
| `run_tests` | Run test suites (auto-detect) |
| `lint_code` | Run linters (auto-detect) |
| `scaffold_project` | Generate project boilerplate |
| `fetch_api` | HTTP requests to any public API |
| `parse_csv` | Parse CSV/TSV files |
| `transform_json` | Extract/transform JSON data |
| `summarize_url` | Fetch and extract text from URLs |
| `send_notification` | macOS desktop notifications |
| `docker_manage` | Docker container management |
| `log_analyzer` | Log file analysis |
| `git_diff` | Show diffs between refs |
| `git_branch` | Manage branches |
| `repo_stats` | Repository statistics |
| `image_prompt` | AI image generation prompts |
| `test_coverage` | Test coverage reports |
| `benchmark` | Command benchmarking |

### Enterprise Tier
| Tool | Description |
|------|-------------|
| `query_database` | SQLite queries |
| `schema_inspector` | Database schema viewer |
| `export_data` | Export tables to JSON/CSV |
| `ci_status` | GitHub Actions CI status |

### Management Tools
| Tool | Description |
|------|-------------|
| `license_info` | View license and available tools |
| `activate_license` | Activate a license key |
| `usage_stats` | Usage statistics and trends |

## Quick Start

```bash
npm install
npm run build
```

## Connect (stdio — local)

```bash
# Claude Code
claude mcp add ai-intelligence-mcp -- node /path/to/AI-Intelligence-MCP-/dist/index.js

# Claude Desktop — add to ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "ai-intelligence-mcp": {
      "command": "node",
      "args": ["/path/to/AI-Intelligence-MCP-/dist/index.js"]
    }
  }
}
```

## Connect (HTTP — remote/hosted)

```bash
# Start the HTTP server
npm run start:http

# With auth enabled
API_KEYS=your-secret-key npm run start:http

# Connect from Claude Code
claude mcp add --transport sse ai-intelligence-mcp http://localhost:3000/sse
```

### HTTP Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info |
| `/health` | GET | Health check |
| `/sse` | GET | MCP SSE connection |
| `/messages` | POST | MCP message handler |

## Licensing

| Tier | Tools | Rate Limit |
|------|-------|------------|
| **Free** | 8 core tools | 50 calls/day |
| **Pro** | 24 tools | 1,000 calls/day |
| **Enterprise** | All 28+ tools | Unlimited |

## Test with MCP Inspector

```bash
npm run inspect
```
