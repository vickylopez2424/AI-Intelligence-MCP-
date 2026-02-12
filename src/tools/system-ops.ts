import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { cpus, totalmem, freemem, uptime, hostname, platform, arch } from "os";
import {
  validateContainerName,
  validatePort,
  validateFilePath,
  sanitizeError,
  MAX_STRING_LENGTH,
  MAX_FILE_SIZE,
} from "../utils/validation.js";

const execFileAsync = promisify(execFile);

export function registerSystemTools(server: McpServer) {
  // --- system_health ---
  server.tool(
    "system_health",
    "Get system health info: CPU, memory, disk usage, and uptime.",
    {},
    async () => {
      try {
        const cpu = cpus();
        const totalMem = totalmem();
        const freeMem = freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

        // Get disk usage using execFile (no shell)
        const { stdout: diskOutput } = await execFileAsync("df", ["-h", "/"]);
        const diskLines = diskOutput.trim().split("\n");
        const diskParts = diskLines[diskLines.length - 1].split(/\s+/);

        const uptimeHours = (uptime() / 3600).toFixed(1);

        return {
          content: [
            {
              type: "text" as const,
              text: `## System Health

| Metric | Value |
|--------|-------|
| **Platform** | ${platform()} ${arch()} |
| **CPU** | ${cpu[0].model} (${cpu.length} cores) |
| **Memory** | ${(usedMem / 1e9).toFixed(1)} GB / ${(totalMem / 1e9).toFixed(1)} GB (${memPercent}%) |
| **Disk (/)** | ${diskParts[2]} used / ${diskParts[1]} total (${diskParts[4]}) |
| **Uptime** | ${uptimeHours} hours |`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `System health error: ${sanitizeError(error)}` },
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
        .max(200)
        .optional()
        .describe("Container name or ID (required for start/stop/inspect/logs)"),
      tail: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .describe("Number of log lines to show (for 'logs' action)"),
    },
    async ({ action, container, tail }) => {
      try {
        let args: string[];

        switch (action) {
          case "list":
            args = ["ps", "-a", "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"];
            break;
          case "start":
          case "stop":
          case "inspect":
            if (!container) throw new Error("Container name/ID required");
            if (!validateContainerName(container)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Error: Invalid container name. Use only letters, numbers, dots, hyphens, and underscores.",
                  },
                ],
              };
            }
            args = [action, container];
            break;
          case "logs":
            if (!container) throw new Error("Container name/ID required");
            if (!validateContainerName(container)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Error: Invalid container name. Use only letters, numbers, dots, hyphens, and underscores.",
                  },
                ],
              };
            }
            args = ["logs", "--tail", String(tail), container];
            break;
        }

        const { stdout, stderr } = await execFileAsync("docker", args!, { timeout: 15000 });

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
              text: `## Docker Error\n\n${sanitizeError(error)}\n\nMake sure Docker is installed and running.`,
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
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Specific port to check (1-65535). If not provided, lists all listening ports."),
    },
    async ({ port }) => {
      try {
        if (port !== undefined && !validatePort(port)) {
          return {
            content: [
              { type: "text" as const, text: "Error: Port must be an integer between 1 and 65535." },
            ],
          };
        }

        let stdout: string;
        if (port) {
          const result = await execFileAsync("lsof", ["-i", `:${port}`, "-P", "-n"], {
            timeout: 10000,
          });
          stdout = result.stdout;
        } else {
          const result = await execFileAsync("lsof", ["-i", "-P", "-n"], {
            timeout: 10000,
          });
          // Filter to LISTEN lines programmatically
          const lines = result.stdout.split("\n");
          const header = lines[0];
          const listenLines = lines.filter((l) => l.includes("LISTEN"));
          stdout = [header, ...listenLines.slice(0, 30)].join("\n");
        }

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
        // lsof exits with 1 when no results found
        if (error.code === 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: port ? `Port ${port} is not in use.` : "No listening ports found.",
              },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Port scan error: ${sanitizeError(error)}` }],
        };
      }
    }
  );

  // --- log_analyzer ---
  server.tool(
    "log_analyzer",
    "Analyze a log file — show recent entries, filter by pattern, or get error summary.",
    {
      filePath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the log file"),
      action: z
        .enum(["tail", "errors", "filter", "stats"])
        .describe("Analysis action: 'tail' for last N lines, 'errors' for error lines, 'filter' for pattern matching, 'stats' for summary"),
      lines: z.number().int().min(1).max(1000).default(50).describe("Number of lines for 'tail'"),
      pattern: z.string().max(500).optional().describe("Text pattern to search for (required for 'filter'). Uses simple string matching."),
    },
    async ({ filePath, action, lines, pattern }) => {
      try {
        const pathCheck = await validateFilePath(filePath, {
          mustExist: true,
          maxSize: MAX_FILE_SIZE,
          allowedExtensions: ["log", "txt", "out", "err"],
        });
        if (!pathCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
        }

        const content = await readFile(pathCheck.resolvedPath, "utf-8");
        const allLines = content.split("\n");

        switch (action) {
          case "tail": {
            const tailLines = allLines.slice(-lines);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Last ${lines} lines of ${pathCheck.resolvedPath}\n\n\`\`\`\n${tailLines.join("\n")}\n\`\`\``,
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
                  text: `## Errors in ${pathCheck.resolvedPath}\n\n**Found ${errorLines.length} error lines**\n\n\`\`\`\n${errorLines.slice(-30).join("\n")}\n\`\`\``,
                },
              ],
            };
          }
          case "filter": {
            if (!pattern) throw new Error("Pattern required for 'filter'");
            // Use safe string matching instead of RegExp to prevent ReDoS
            const lowerPattern = pattern.toLowerCase();
            const matches = allLines.filter((l) =>
              l.toLowerCase().includes(lowerPattern)
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Filtered: "${pattern}" in ${pathCheck.resolvedPath}\n\n**${matches.length} matches**\n\n\`\`\`\n${matches.slice(0, 50).join("\n")}\n\`\`\``,
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
                  text: `## Log Stats: ${pathCheck.resolvedPath}\n\n| Level | Count |\n|-------|-------|\n| Total Lines | ${allLines.length} |\n| Errors | ${errors} |\n| Warnings | ${warnings} |\n| Info | ${infos} |`,
                },
              ],
            };
          }
        }
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Log analysis error: ${sanitizeError(error)}` }],
        };
      }
    }
  );
}
