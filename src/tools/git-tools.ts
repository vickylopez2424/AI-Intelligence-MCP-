import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  validateDirectory,
  validateName,
  sanitizeError,
  MAX_STRING_LENGTH,
} from "../utils/validation.js";

const execFileAsync = promisify(execFile);

export function registerGitTools(server: McpServer) {
  // --- git_status ---
  server.tool(
    "git_status",
    "Get the full git status of a repository — branch, staged, unstaged, and untracked files.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the git repository"),
    },
    async ({ directory }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        const [branch, status, log] = await Promise.all([
          execFileAsync("git", ["branch", "--show-current"], { cwd: dirCheck.resolvedPath }),
          execFileAsync("git", ["status", "--porcelain"], { cwd: dirCheck.resolvedPath }),
          execFileAsync("git", ["log", "--oneline", "-5"], { cwd: dirCheck.resolvedPath }),
        ]);

        const staged = status.stdout.split("\n").filter((l) => /^[MADRC]/.test(l));
        const unstaged = status.stdout.split("\n").filter((l) => /^.[MADRC]/.test(l));
        const untracked = status.stdout.split("\n").filter((l) => l.startsWith("??"));

        return {
          content: [
            {
              type: "text" as const,
              text: `## Git Status\n\n**Branch:** ${branch.stdout.trim()}\n**Staged:** ${staged.length} files\n**Unstaged:** ${unstaged.length} files\n**Untracked:** ${untracked.length} files\n\n### Recent Commits\n\`\`\`\n${log.stdout}\`\`\`\n${status.stdout ? `### Changes\n\`\`\`\n${status.stdout}\`\`\`` : "Working tree clean."}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Git error: ${sanitizeError(error)}` }],
        };
      }
    }
  );

  // --- git_log ---
  server.tool(
    "git_log",
    "View commit history with optional filtering by author, date range, or file path.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the git repository"),
      count: z.number().int().min(1).max(100).default(20).describe("Number of commits to show"),
      author: z.string().max(200).optional().describe("Filter by author name or email"),
      since: z.string().max(50).optional().describe("Show commits after date (e.g. '2024-01-01', '2 weeks ago')"),
      until: z.string().max(50).optional().describe("Show commits before date"),
      file: z.string().max(500).optional().describe("Show commits affecting a specific file path"),
    },
    async ({ directory, count, author, since, until, file }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        const args = [
          "log",
          `--max-count=${count}`,
          "--format=%h | %an | %ar | %s",
        ];
        if (author) args.push(`--author=${author}`);
        if (since) args.push(`--since=${since}`);
        if (until) args.push(`--until=${until}`);
        if (file) {
          args.push("--");
          args.push(file);
        }

        const { stdout } = await execFileAsync("git", args, {
          cwd: dirCheck.resolvedPath,
        });

        const lines = stdout.trim().split("\n").filter(Boolean);

        return {
          content: [
            {
              type: "text" as const,
              text: `## Git Log (${lines.length} commits)\n\n| Hash | Author | When | Message |\n|------|--------|------|---------|\n${lines.map((l) => `| ${l} |`).join("\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Git log error: ${sanitizeError(error)}` }],
        };
      }
    }
  );

  // --- git_diff ---
  server.tool(
    "git_diff",
    "Show the diff of changes — staged, unstaged, or between commits/branches.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the git repository"),
      staged: z.boolean().default(false).describe("Show staged changes (--cached)"),
      ref1: z.string().max(200).optional().describe("First ref (commit hash, branch, tag)"),
      ref2: z.string().max(200).optional().describe("Second ref to compare against"),
      file: z.string().max(500).optional().describe("Limit diff to a specific file"),
    },
    async ({ directory, staged, ref1, ref2, file }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        const args = ["diff", "--stat"];
        if (staged) args.push("--cached");
        if (ref1) args.push(ref1);
        if (ref2) args.push(ref2);
        if (file) {
          args.push("--");
          args.push(file);
        }

        // Get stat summary
        const { stdout: statOutput } = await execFileAsync("git", args, {
          cwd: dirCheck.resolvedPath,
        });

        // Get actual diff (limited)
        const diffArgs = args.filter((a) => a !== "--stat");
        diffArgs.splice(1, 0, "--no-color");
        const { stdout: diffOutput } = await execFileAsync("git", diffArgs, {
          cwd: dirCheck.resolvedPath,
        });

        const truncatedDiff =
          diffOutput.length > 5000
            ? diffOutput.substring(0, 5000) + "\n\n... (truncated)"
            : diffOutput;

        return {
          content: [
            {
              type: "text" as const,
              text: `## Git Diff${staged ? " (staged)" : ""}${ref1 ? ` ${ref1}` : ""}${ref2 ? `..${ref2}` : ""}\n\n### Summary\n\`\`\`\n${statOutput || "No changes."}\n\`\`\`\n\n### Diff\n\`\`\`diff\n${truncatedDiff || "No changes."}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Git diff error: ${sanitizeError(error)}` }],
        };
      }
    }
  );

  // --- git_branch ---
  server.tool(
    "git_branch",
    "List, create, or delete git branches.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the git repository"),
      action: z.enum(["list", "create", "delete"]).default("list").describe("Branch action"),
      name: z.string().max(200).optional().describe("Branch name (for create/delete)"),
    },
    async ({ directory, action, name }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        switch (action) {
          case "list": {
            const { stdout } = await execFileAsync(
              "git",
              ["branch", "-a", "--format=%(refname:short) %(upstream:short) %(HEAD)"],
              { cwd: dirCheck.resolvedPath }
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `## Branches\n\n\`\`\`\n${stdout}\`\`\``,
                },
              ],
            };
          }
          case "create": {
            if (!name) return { content: [{ type: "text" as const, text: "Error: Branch name required." }] };
            if (!/^[a-zA-Z0-9._\/-]+$/.test(name)) {
              return { content: [{ type: "text" as const, text: "Error: Invalid branch name." }] };
            }
            await execFileAsync("git", ["branch", name], { cwd: dirCheck.resolvedPath });
            return {
              content: [{ type: "text" as const, text: `Created branch: ${name}` }],
            };
          }
          case "delete": {
            if (!name) return { content: [{ type: "text" as const, text: "Error: Branch name required." }] };
            if (name === "main" || name === "master") {
              return { content: [{ type: "text" as const, text: "Error: Cannot delete main/master branch." }] };
            }
            // Use -d (safe delete, not -D force)
            await execFileAsync("git", ["branch", "-d", name], { cwd: dirCheck.resolvedPath });
            return {
              content: [{ type: "text" as const, text: `Deleted branch: ${name}` }],
            };
          }
        }
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Git branch error: ${sanitizeError(error)}` }],
        };
      }
    }
  );

  // --- repo_stats ---
  server.tool(
    "repo_stats",
    "Get repository statistics — contributor counts, file breakdown, commit frequency.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the git repository"),
    },
    async ({ directory }) => {
      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      try {
        const [contributors, totalCommits, firstCommit, fileCount] = await Promise.all([
          execFileAsync("git", ["shortlog", "-sn", "--all", "--no-merges"], {
            cwd: dirCheck.resolvedPath,
          }),
          execFileAsync("git", ["rev-list", "--count", "HEAD"], {
            cwd: dirCheck.resolvedPath,
          }),
          execFileAsync("git", ["log", "--reverse", "--format=%ar", "--max-count=1"], {
            cwd: dirCheck.resolvedPath,
          }),
          execFileAsync("git", ["ls-files"], {
            cwd: dirCheck.resolvedPath,
          }),
        ]);

        const files = fileCount.stdout.trim().split("\n").filter(Boolean);
        const extCounts: Record<string, number> = {};
        for (const f of files) {
          const ext = f.split(".").pop() || "no-ext";
          extCounts[ext] = (extCounts[ext] || 0) + 1;
        }
        const topExts = Object.entries(extCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([ext, count]) => `| .${ext} | ${count} |`)
          .join("\n");

        const contribLines = contributors.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(0, 10)
          .map((l) => {
            const match = l.trim().match(/^(\d+)\s+(.+)$/);
            return match ? `| ${match[2]} | ${match[1]} |` : "";
          })
          .filter(Boolean)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `## Repository Stats\n\n| Metric | Value |\n|--------|-------|\n| **Total Commits** | ${totalCommits.stdout.trim()} |\n| **Files** | ${files.length} |\n| **Started** | ${firstCommit.stdout.trim()} |\n\n### Top Contributors\n| Author | Commits |\n|--------|---------|\n${contribLines}\n\n### File Types\n| Extension | Count |\n|-----------|-------|\n${topExts}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Repo stats error: ${sanitizeError(error)}` }],
        };
      }
    }
  );
}
