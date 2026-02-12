import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { join } from "path";
import {
  validateDirectory,
  sanitizeError,
  MAX_STRING_LENGTH,
} from "../utils/validation.js";

const execFileAsync = promisify(execFile);

export function registerTestingTools(server: McpServer) {
  // --- test_coverage ---
  server.tool(
    "test_coverage",
    "Run tests with code coverage and return a coverage summary. Supports Jest, pytest, and go test.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the project directory"),
      runner: z
        .enum(["jest", "pytest", "go", "auto"])
        .default("auto")
        .describe("Test runner to use. 'auto' detects based on project files."),
    },
    async ({ directory, runner }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        let bin: string;
        let args: string[];
        let detectedRunner = runner;

        if (runner === "auto") {
          try {
            await stat(join(dirCheck.resolvedPath, "package.json"));
            detectedRunner = "jest";
          } catch {
            try {
              await stat(join(dirCheck.resolvedPath, "pytest.ini"));
              detectedRunner = "pytest";
            } catch {
              try {
                await stat(join(dirCheck.resolvedPath, "go.mod"));
                detectedRunner = "go";
              } catch {
                return {
                  content: [
                    { type: "text" as const, text: "Could not auto-detect test runner. Specify one explicitly." },
                  ],
                };
              }
            }
          }
        }

        switch (detectedRunner) {
          case "jest":
            bin = "npx";
            args = ["jest", "--coverage", "--coverageReporters=text", "--no-colors"];
            break;
          case "pytest":
            bin = "pytest";
            args = ["--cov=.", "--cov-report=term-missing", "--no-header", "-q"];
            break;
          case "go":
            bin = "go";
            args = ["test", "-cover", "./..."];
            break;
          default:
            return {
              content: [{ type: "text" as const, text: "Unknown test runner." }],
            };
        }

        const { stdout, stderr } = await execFileAsync(bin, args, {
          cwd: dirCheck.resolvedPath,
          timeout: 120000,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Test Coverage — ${detectedRunner}\n\n\`\`\`\n${stdout}\n\`\`\`\n${stderr ? `### Notes\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Coverage Error\n\n\`\`\`\n${error.stdout || ""}\n${error.stderr || sanitizeError(error)}\n\`\`\``,
            },
          ],
        };
      }
    }
  );

  // --- benchmark ---
  server.tool(
    "benchmark",
    "Run a simple benchmark — execute a command multiple times and report timing statistics.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to run the benchmark in"),
      command: z.string().max(500).describe("Command to benchmark (must be an allowed executable)"),
      iterations: z.number().int().min(1).max(100).default(10).describe("Number of iterations"),
    },
    async ({ directory, command, iterations }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      // Only allow safe benchmarking commands
      const parts = command.split(/\s+/);
      const bin = parts[0];
      const args = parts.slice(1);

      const allowedBins = [
        "node", "python", "python3", "go", "cargo", "ruby",
        "npm", "npx", "make", "curl", "time",
      ];
      if (!allowedBins.includes(bin)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: '${bin}' is not an allowed benchmark command. Allowed: ${allowedBins.join(", ")}`,
            },
          ],
        };
      }

      try {
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          await execFileAsync(bin, args, {
            cwd: dirCheck.resolvedPath,
            timeout: 30000,
          });
          times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        const sorted = [...times].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const stddev = Math.sqrt(
          times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `## Benchmark Results\n\n**Command:** \`${command}\`\n**Iterations:** ${iterations}\n\n| Metric | Value |\n|--------|-------|\n| **Average** | ${avg.toFixed(1)} ms |\n| **Median** | ${median.toFixed(1)} ms |\n| **Min** | ${min.toFixed(1)} ms |\n| **Max** | ${max.toFixed(1)} ms |\n| **Std Dev** | ${stddev.toFixed(1)} ms |\n\n### Per-Run Times\n\`\`\`\n${times.map((t, i) => `Run ${i + 1}: ${t.toFixed(1)} ms`).join("\n")}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Benchmark Error\n\n${sanitizeError(error)}` },
          ],
        };
      }
    }
  );

  // --- ci_status ---
  server.tool(
    "ci_status",
    "Check GitHub Actions CI status for a repository using the gh CLI.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to a git repository with a GitHub remote"),
      branch: z.string().max(200).optional().describe("Branch to check. Defaults to current branch."),
    },
    async ({ directory, branch }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        // Get current branch if not specified
        let targetBranch = branch;
        if (!targetBranch) {
          const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
            cwd: dirCheck.resolvedPath,
          });
          targetBranch = stdout.trim();
        }

        // Get CI status via gh CLI
        const { stdout } = await execFileAsync(
          "gh",
          ["run", "list", "--branch", targetBranch, "--limit", "5", "--json", "status,conclusion,name,createdAt,url"],
          { cwd: dirCheck.resolvedPath, timeout: 15000 }
        );

        const runs = JSON.parse(stdout);

        if (runs.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No CI runs found for branch '${targetBranch}'.` },
            ],
          };
        }

        const table = runs
          .map((r: any) => {
            const status =
              r.conclusion === "success"
                ? "PASS"
                : r.conclusion === "failure"
                  ? "FAIL"
                  : r.status === "in_progress"
                    ? "RUNNING"
                    : r.status;
            return `| ${r.name} | ${status} | ${r.createdAt} |`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `## CI Status — ${targetBranch}\n\n| Workflow | Status | Created |\n|----------|--------|---------|\n${table}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## CI Status Error\n\n${sanitizeError(error)}\n\nMake sure 'gh' CLI is installed and authenticated.`,
            },
          ],
        };
      }
    }
  );
}
