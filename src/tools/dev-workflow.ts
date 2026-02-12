import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readdir, stat } from "fs/promises";
import { join } from "path";

const execAsync = promisify(exec);

export function registerDevTools(server: McpServer) {
  // --- run_tests ---
  server.tool(
    "run_tests",
    "Run a test suite in a project directory. Supports npm test, pytest, go test, and more.",
    {
      directory: z.string().describe("Absolute path to the project directory"),
      command: z
        .string()
        .optional()
        .describe(
          "Custom test command to run. If not provided, auto-detects based on project type."
        ),
    },
    async ({ directory, command }) => {
      try {
        let testCmd = command;

        if (!testCmd) {
          // Auto-detect test runner
          try {
            await stat(join(directory, "package.json"));
            testCmd = "npm test";
          } catch {
            try {
              await stat(join(directory, "pytest.ini"));
              testCmd = "pytest";
            } catch {
              try {
                await stat(join(directory, "go.mod"));
                testCmd = "go test ./...";
              } catch {
                testCmd = "echo 'No test runner detected. Provide a custom command.'";
              }
            }
          }
        }

        const { stdout, stderr } = await execAsync(testCmd, {
          cwd: directory,
          timeout: 60000,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Test Results\n\n**Command:** \`${testCmd}\`\n**Directory:** ${directory}\n\n### Output\n\`\`\`\n${stdout}\n\`\`\`\n${stderr ? `### Stderr\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Test Failed\n\n**Command:** \`${command}\`\n\n### Error\n\`\`\`\n${error.stdout || ""}\n${error.stderr || error.message}\n\`\`\``,
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
      directory: z.string().describe("Absolute path to the project directory"),
      files: z
        .string()
        .optional()
        .describe("Specific files to lint (space-separated). Defaults to entire project."),
      command: z.string().optional().describe("Custom lint command to run."),
    },
    async ({ directory, files, command }) => {
      try {
        let lintCmd = command;

        if (!lintCmd) {
          try {
            await stat(join(directory, "node_modules/.bin/eslint"));
            lintCmd = `npx eslint ${files || "."}`;
          } catch {
            try {
              await stat(join(directory, "setup.py"));
              lintCmd = `pylint ${files || "."}`;
            } catch {
              lintCmd = `echo 'No linter detected. Provide a custom command.'`;
            }
          }
        }

        const { stdout, stderr } = await execAsync(lintCmd, {
          cwd: directory,
          timeout: 60000,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Lint Results\n\n**Command:** \`${lintCmd}\`\n\n\`\`\`\n${stdout || "No issues found!"}\n\`\`\`\n${stderr ? `### Warnings\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Lint Issues Found\n\n\`\`\`\n${error.stdout || ""}\n${error.stderr || error.message}\n\`\`\``,
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
      name: z.string().describe("Project name"),
      type: z
        .enum(["node-ts", "node-js", "python", "go", "react", "express-api"])
        .describe("Project type to scaffold"),
      directory: z.string().describe("Parent directory where the project folder will be created"),
    },
    async ({ name, type, directory }) => {
      const projectDir = join(directory, name);
      const commands: string[] = [`mkdir -p "${projectDir}"`];

      switch (type) {
        case "node-ts":
          commands.push(
            `cd "${projectDir}" && npm init -y`,
            `cd "${projectDir}" && npm install -D typescript @types/node`,
            `cd "${projectDir}" && npx tsc --init`,
            `mkdir -p "${projectDir}/src"`,
            `echo 'console.log("Hello from ${name}!");' > "${projectDir}/src/index.ts"`
          );
          break;
        case "node-js":
          commands.push(
            `cd "${projectDir}" && npm init -y`,
            `echo 'console.log("Hello from ${name}!");' > "${projectDir}/index.js"`
          );
          break;
        case "python":
          commands.push(
            `mkdir -p "${projectDir}/src"`,
            `echo 'print("Hello from ${name}!")' > "${projectDir}/src/main.py"`,
            `echo '# ${name}' > "${projectDir}/README.md"`,
            `touch "${projectDir}/requirements.txt"`
          );
          break;
        case "go":
          commands.push(
            `cd "${projectDir}" && go mod init ${name}`,
            `echo 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from ${name}!")\n}' > "${projectDir}/main.go"`
          );
          break;
        case "react":
          commands.push(`npx create-react-app "${projectDir}" --template typescript`);
          break;
        case "express-api":
          commands.push(
            `cd "${projectDir}" && npm init -y`,
            `cd "${projectDir}" && npm install express`,
            `cd "${projectDir}" && npm install -D typescript @types/node @types/express`,
            `mkdir -p "${projectDir}/src"`,
            `cat > "${projectDir}/src/index.ts" << 'SCAFFOLD'
import express from "express";
const app = express();
app.use(express.json());
app.get("/health", (_, res) => res.json({ status: "ok" }));
app.listen(3000, () => console.log("Server running on :3000"));
SCAFFOLD`
          );
          break;
      }

      try {
        for (const cmd of commands) {
          await execAsync(cmd, { timeout: 120000 });
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
            {
              type: "text" as const,
              text: `## Scaffold Error\n\n${error.message}`,
            },
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
      directory: z.string().describe("Absolute path to search in"),
      pattern: z.string().describe("Text or regex pattern to search for"),
      fileType: z
        .string()
        .optional()
        .describe("File extension filter, e.g. 'ts', 'py', 'md'"),
    },
    async ({ directory, pattern, fileType }) => {
      try {
        const globFlag = fileType ? `--include='*.${fileType}'` : "";
        const { stdout } = await execAsync(
          `grep -rn ${globFlag} "${pattern}" "${directory}" | head -50`,
          { timeout: 15000 }
        );

        const lines = stdout.trim().split("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `## Search Results\n\n**Pattern:** \`${pattern}\`\n**Directory:** ${directory}\n**Matches:** ${lines.length}\n\n\`\`\`\n${stdout}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        if (error.code === 1) {
          return {
            content: [
              { type: "text" as const, text: `No matches found for \`${pattern}\` in ${directory}` },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
        };
      }
    }
  );
}
