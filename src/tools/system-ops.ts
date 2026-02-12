import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { cpus, totalmem, freemem, uptime, hostname, platform, arch } from "os";

const execAsync = promisify(exec);

export function registerSystemTools(server: McpServer) {
  // --- system_health ---
  server.tool(
    "system_health",
    "Get system health info: CPU, memory, disk usage, uptime, and OS details.",
    {},
    async () => {
      try {
        const cpu = cpus();
        const totalMem = totalmem();
        const freeMem = freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

        // Get disk usage
        const { stdout: diskOutput } = await execAsync("df -h / | tail -1");
        const diskParts = diskOutput.trim().split(/\s+/);

        // Get load average
        const { stdout: loadOutput } = await execAsync("uptime");
        const loadMatch = loadOutput.match(/load averages?:\s*([\d.]+)/);

        const uptimeHours = (uptime() / 3600).toFixed(1);

        return {
          content: [
            {
              type: "text" as const,
              text: `## System Health

| Metric | Value |
|--------|-------|
| **Hostname** | ${hostname()} |
| **Platform** | ${platform()} ${arch()} |
| **CPU** | ${cpu[0].model} (${cpu.length} cores) |
| **Memory** | ${(usedMem / 1e9).toFixed(1)} GB / ${(totalMem / 1e9).toFixed(1)} GB (${memPercent}%) |
| **Disk (/)** | ${diskParts[2]} used / ${diskParts[1]} total (${diskParts[4]}) |
| **Load Avg** | ${loadMatch ? loadMatch[1] : "N/A"} |
| **Uptime** | ${uptimeHours} hours |`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `System health error: ${error.message}` },
          ],
        };
      }
    }
  );

  // --- docker_manage ---
  server.tool(
    "docker_manage",
    "List, start, stop, or inspect Docker containers.",
    {
      action: z
        .enum(["list", "start", "stop", "inspect", "logs"])
        .describe("Action to perform"),
      container: z
        .string()
        .optional()
        .describe("Container name or ID (required for start/stop/inspect/logs)"),
      tail: z
        .number()
        .default(50)
        .describe("Number of log lines to show (for 'logs' action)"),
    },
    async ({ action, container, tail }) => {
      try {
        let cmd: string;

        switch (action) {
          case "list":
            cmd = "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'";
            break;
          case "start":
            if (!container) throw new Error("Container name/ID required");
            cmd = `docker start ${container}`;
            break;
          case "stop":
            if (!container) throw new Error("Container name/ID required");
            cmd = `docker stop ${container}`;
            break;
          case "inspect":
            if (!container) throw new Error("Container name/ID required");
            cmd = `docker inspect ${container}`;
            break;
          case "logs":
            if (!container) throw new Error("Container name/ID required");
            cmd = `docker logs --tail ${tail} ${container}`;
            break;
        }

        const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Docker — ${action}\n\n\`\`\`\n${stdout}\n\`\`\`\n${stderr ? `\n${stderr}` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Docker Error\n\n${error.message}\n\nMake sure Docker is installed and running.`,
            },
          ],
        };
      }
    }
  );

  // --- port_scan ---
  server.tool(
    "port_scan",
    "Check which ports are in use on the local machine and what processes are using them.",
    {
      port: z
        .number()
        .optional()
        .describe("Specific port to check. If not provided, lists all listening ports."),
    },
    async ({ port }) => {
      try {
        const cmd = port
          ? `lsof -i :${port} -P -n | head -20`
          : "lsof -i -P -n | grep LISTEN | head -30";

        const { stdout } = await execAsync(cmd, { timeout: 10000 });

        if (!stdout.trim()) {
          return {
            content: [
              {
                type: "text" as const,
                text: port
                  ? `Port ${port} is not in use.`
                  : "No listening ports found.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## ${port ? `Port ${port}` : "Listening Ports"}\n\n\`\`\`\n${stdout}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Port scan error: ${error.message}` }],
        };
      }
    }
  );

  // --- log_analyzer ---
  server.tool(
    "log_analyzer",
    "Analyze a log file — show recent entries, filter by pattern, or get error summary.",
    {
      filePath: z.string().describe("Absolute path to the log file"),
      action: z
        .enum(["tail", "errors", "filter", "stats"])
        .describe("Analysis action: 'tail' for last N lines, 'errors' for error lines, 'filter' for pattern matching, 'stats' for summary"),
      lines: z.number().default(50).describe("Number of lines for 'tail'"),
      pattern: z.string().optional().describe("Pattern to search for (required for 'filter')"),
    },
    async ({ filePath, action, lines, pattern }) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const allLines = content.split("\n");

        switch (action) {
          case "tail": {
            const tailLines = allLines.slice(-lines);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Last ${lines} lines of ${filePath}\n\n\`\`\`\n${tailLines.join("\n")}\n\`\`\``,
                },
              ],
            };
          }
          case "errors": {
            const errorLines = allLines.filter(
              (l) => /error|exception|fatal|critical/i.test(l)
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Errors in ${filePath}\n\n**Found ${errorLines.length} error lines**\n\n\`\`\`\n${errorLines.slice(-30).join("\n")}\n\`\`\``,
                },
              ],
            };
          }
          case "filter": {
            if (!pattern) throw new Error("Pattern required for 'filter'");
            const regex = new RegExp(pattern, "i");
            const matches = allLines.filter((l) => regex.test(l));
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Filtered: "${pattern}" in ${filePath}\n\n**${matches.length} matches**\n\n\`\`\`\n${matches.slice(0, 50).join("\n")}\n\`\`\``,
                },
              ],
            };
          }
          case "stats": {
            const errors = allLines.filter((l) => /error/i.test(l)).length;
            const warnings = allLines.filter((l) => /warn/i.test(l)).length;
            const infos = allLines.filter((l) => /info/i.test(l)).length;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Log Stats: ${filePath}\n\n| Level | Count |\n|-------|-------|\n| Total Lines | ${allLines.length} |\n| Errors | ${errors} |\n| Warnings | ${warnings} |\n| Info | ${infos} |`,
                },
              ],
            };
          }
        }
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Log analysis error: ${error.message}` }],
        };
      }
    }
  );
}
