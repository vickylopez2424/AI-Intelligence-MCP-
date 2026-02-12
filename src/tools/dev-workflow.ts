import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, stat, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  validateDirectory,
  validateName,
  validateFileExtension,
  sanitizeError,
  MAX_STRING_LENGTH,
} from "../utils/validation.js";

const execFileAsync = promisify(execFile);

// Allowlisted test commands (prefix match)
const ALLOWED_TEST_COMMANDS = [
  "npm test",
  "npx jest",
  "npx vitest",
  "npx mocha",
  "pytest",
  "python -m pytest",
  "go test",
  "cargo test",
  "make test",
];

// Allowlisted lint commands (prefix match)
const ALLOWED_LINT_COMMANDS = [
  "npx eslint",
  "npx prettier",
  "pylint",
  "flake8",
  "mypy",
  "go vet",
  "cargo clippy",
  "make lint",
];

function isAllowedCommand(command: string, allowlist: string[]): boolean {
  return allowlist.some((prefix) => command.startsWith(prefix));
}

export function registerDevTools(server: McpServer) {
  // --- run_tests ---
  server.tool(
    "run_tests",
    "Run a test suite in a project directory. Supports npm test, pytest, go test, and more.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the project directory"),
      command: z
        .string()
        .max(MAX_STRING_LENGTH)
        .optional()
        .describe(
          "Custom test command to run. Must be an allowed test command (npm test, pytest, go test, etc.)."
        ),
    },
    async ({ directory, command }) => {
      try {
        const dirCheck = await validateDirectory(directory);
        if (!dirCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
        }

        let testArgs: string[];
        let testBin: string;

        if (command) {
          if (!isAllowedCommand(command, ALLOWED_TEST_COMMANDS)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Command not allowed. Allowed commands: ${ALLOWED_TEST_COMMANDS.join(", ")}`,
                },
              ],
            };
          }
          const parts = command.split(/\s+/);
          testBin = parts[0];
          testArgs = parts.slice(1);
        } else {
          // Auto-detect test runner
          try {
            await stat(join(dirCheck.resolvedPath, "package.json"));
            testBin = "npm";
            testArgs = ["test"];
          } catch {
            try {
              await stat(join(dirCheck.resolvedPath, "pytest.ini"));
              testBin = "pytest";
              testArgs = [];
            } catch {
              try {
                await stat(join(dirCheck.resolvedPath, "go.mod"));
                testBin = "go";
                testArgs = ["test", "./..."];
              } catch {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: "No test runner detected. Provide a custom command.",
                    },
                  ],
                };
              }
            }
          }
        }

        const { stdout, stderr } = await execFileAsync(testBin, testArgs, {
          cwd: dirCheck.resolvedPath,
          timeout: 60000,
        });

        const cmdDisplay = `${testBin} ${testArgs.join(" ")}`.trim();
        return {
          content: [
            {
              type: "text" as const,
              text: `## Test Results\n\n**Command:** \`${cmdDisplay}\`\n**Directory:** ${dirCheck.resolvedPath}\n\n### Output\n\`\`\`\n${stdout}\n\`\`\`\n${stderr ? `### Stderr\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Test Failed\n\n### Error\n\`\`\`\n${error.stdout || ""}\n${error.stderr || sanitizeError(error)}\n\`\`\``,
            },
          ],
        };
      }
    }
  );

  // --- lint_code ---
  server.tool(
    "lint_code",
    "Run a linter on a project or specific files. Auto-detects eslint, pylint, etc.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the project directory"),
      files: z
        .string()
        .max(MAX_STRING_LENGTH)
        .optional()
        .describe("Specific files to lint (space-separated). Must be relative paths with no special characters."),
      command: z
        .string()
        .max(MAX_STRING_LENGTH)
        .optional()
        .describe("Custom lint command to run. Must be an allowed lint command."),
    },
    async ({ directory, files, command }) => {
      try {
        const dirCheck = await validateDirectory(directory);
        if (!dirCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
        }

        let lintBin: string;
        let lintArgs: string[];

        if (command) {
          if (!isAllowedCommand(command, ALLOWED_LINT_COMMANDS)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Command not allowed. Allowed commands: ${ALLOWED_LINT_COMMANDS.join(", ")}`,
                },
              ],
            };
          }
          const parts = command.split(/\s+/);
          lintBin = parts[0];
          lintArgs = parts.slice(1);
        } else {
          try {
            await stat(join(dirCheck.resolvedPath, "node_modules/.bin/eslint"));
            lintBin = "npx";
            lintArgs = ["eslint"];
          } catch {
            try {
              await stat(join(dirCheck.resolvedPath, "setup.py"));
              lintBin = "pylint";
              lintArgs = [];
            } catch {
              return {
                content: [
                  { type: "text" as const, text: "No linter detected. Provide a custom command." },
                ],
              };
            }
          }
        }

        // Validate file paths — only allow safe relative paths
        if (files) {
          const fileParts = files.split(/\s+/);
          for (const f of fileParts) {
            if (/[;&|`$(){}!<>]/.test(f) || f.includes("..")) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: Invalid file path '${f}'. Paths must be relative with no special characters.`,
                  },
                ],
              };
            }
          }
          lintArgs.push(...fileParts);
        } else {
          lintArgs.push(".");
        }

        const { stdout, stderr } = await execFileAsync(lintBin, lintArgs, {
          cwd: dirCheck.resolvedPath,
          timeout: 60000,
        });

        const cmdDisplay = `${lintBin} ${lintArgs.join(" ")}`.trim();
        return {
          content: [
            {
              type: "text" as const,
              text: `## Lint Results\n\n**Command:** \`${cmdDisplay}\`\n\n\`\`\`\n${stdout || "No issues found!"}\n\`\`\`\n${stderr ? `### Warnings\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Lint Issues Found\n\n\`\`\`\n${error.stdout || ""}\n${error.stderr || sanitizeError(error)}\n\`\`\``,
            },
          ],
        };
      }
    }
  );

  // --- scaffold_project ---
  server.tool(
    "scaffold_project",
    "Generate boilerplate project structure for a new project.",
    {
      name: z
        .string()
        .max(100)
        .describe("Project name (alphanumeric, hyphens, underscores only)"),
      type: z
        .enum(["node-ts", "node-js", "python", "go", "react", "express-api"])
        .describe("Project type to scaffold"),
      directory: z
        .string()
        .max(MAX_STRING_LENGTH)
        .describe("Parent directory where the project folder will be created"),
    },
    async ({ name, type, directory }) => {
      // Validate project name strictly
      if (!validateName(name)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Project name must contain only letters, numbers, hyphens, and underscores.",
            },
          ],
        };
      }

      const dirCheck = await validateDirectory(directory);
      if (!dirCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
      }

      const projectDir = join(dirCheck.resolvedPath, name);

      try {
        await mkdir(join(projectDir, "src"), { recursive: true });

        switch (type) {
          case "node-ts":
            await execFileAsync("npm", ["init", "-y"], { cwd: projectDir });
            await execFileAsync("npm", ["install", "-D", "typescript", "@types/node"], {
              cwd: projectDir,
              timeout: 120000,
            });
            await execFileAsync("npx", ["tsc", "--init"], { cwd: projectDir });
            await writeFile(
              join(projectDir, "src", "index.ts"),
              `console.log("Hello from ${name}!");\n`
            );
            break;
          case "node-js":
            await execFileAsync("npm", ["init", "-y"], { cwd: projectDir });
            await writeFile(
              join(projectDir, "index.js"),
              `console.log("Hello from ${name}!");\n`
            );
            break;
          case "python":
            await writeFile(
              join(projectDir, "src", "main.py"),
              `print("Hello from ${name}!")\n`
            );
            await writeFile(join(projectDir, "README.md"), `# ${name}\n`);
            await writeFile(join(projectDir, "requirements.txt"), "");
            break;
          case "go":
            await execFileAsync("go", ["mod", "init", name], { cwd: projectDir });
            await writeFile(
              join(projectDir, "main.go"),
              `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from ${name}!")\n}\n`
            );
            break;
          case "react":
            await execFileAsync(
              "npx",
              ["create-react-app", projectDir, "--template", "typescript"],
              { timeout: 120000 }
            );
            break;
          case "express-api":
            await execFileAsync("npm", ["init", "-y"], { cwd: projectDir });
            await execFileAsync(
              "npm",
              ["install", "express"],
              { cwd: projectDir, timeout: 120000 }
            );
            await execFileAsync(
              "npm",
              ["install", "-D", "typescript", "@types/node", "@types/express"],
              { cwd: projectDir, timeout: 120000 }
            );
            await writeFile(
              join(projectDir, "src", "index.ts"),
              `import express from "express";\nconst app = express();\napp.use(express.json());\napp.get("/health", (_, res) => res.json({ status: "ok" }));\napp.listen(3000, () => console.log("Server running on :3000"));\n`
            );
            break;
        }

        const files = await readdir(projectDir, { recursive: true });
        return {
          content: [
            {
              type: "text" as const,
              text: `## Project Scaffolded\n\n**Name:** ${name}\n**Type:** ${type}\n**Location:** ${projectDir}\n\n### Files Created\n${files.map((f) => `- ${f}`).join("\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Scaffold Error\n\n${sanitizeError(error)}` },
          ],
        };
      }
    }
  );

  // --- search_docs ---
  server.tool(
    "search_docs",
    "Search for files containing a pattern within a project directory.",
    {
      directory: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to search in"),
      pattern: z.string().max(1000).describe("Text pattern to search for"),
      fileType: z
        .string()
        .max(20)
        .optional()
        .describe("File extension filter, e.g. 'ts', 'py', 'md'"),
    },
    async ({ directory, pattern, fileType }) => {
      try {
        const dirCheck = await validateDirectory(directory);
        if (!dirCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${dirCheck.error}` }] };
        }

        if (fileType && !validateFileExtension(fileType)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: File type must contain only letters and numbers (e.g. 'ts', 'py').",
              },
            ],
          };
        }

        const args = ["-rn", "--max-count=50"];
        if (fileType) {
          args.push(`--include=*.${fileType}`);
        }
        args.push("--", pattern, dirCheck.resolvedPath);

        const { stdout } = await execFileAsync("grep", args, { timeout: 15000 });

        const lines = stdout.trim().split("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `## Search Results\n\n**Pattern:** \`${pattern}\`\n**Directory:** ${dirCheck.resolvedPath}\n**Matches:** ${lines.length}\n\n\`\`\`\n${stdout}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        if (error.code === 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No matches found for \`${pattern}\` in ${directory}`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Search error: ${sanitizeError(error)}` }],
        };
      }
    }
  );
}
