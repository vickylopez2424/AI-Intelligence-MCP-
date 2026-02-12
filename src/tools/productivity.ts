import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  validateUrl,
  sanitizeError,
  MAX_STRING_LENGTH,
} from "../utils/validation.js";

const execFileAsync = promisify(execFile);

const TODOS_FILE = join(homedir(), ".claudeworker-todos.json");

interface Todo {
  id: number;
  text: string;
  done: boolean;
  createdAt: string;
}

async function loadTodos(): Promise<Todo[]> {
  try {
    const content = await readFile(TODOS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveTodos(todos: Todo[]): Promise<void> {
  await writeFile(TODOS_FILE, JSON.stringify(todos, null, 2), { mode: 0o600 });
}

export function registerProductivityTools(server: McpServer) {
  // --- manage_todos ---
  server.tool(
    "manage_todos",
    "Manage a persistent todo list. Add, complete, remove, or list tasks.",
    {
      action: z
        .enum(["add", "complete", "remove", "list"])
        .describe("Action to perform"),
      text: z.string().max(500).optional().describe("Todo text (required for 'add')"),
      id: z.number().int().optional().describe("Todo ID (required for 'complete' and 'remove')"),
    },
    async ({ action, text, id }) => {
      const todos = await loadTodos();

      switch (action) {
        case "add": {
          if (!text) {
            return {
              content: [{ type: "text" as const, text: "Error: 'text' is required for add." }],
            };
          }
          const newTodo: Todo = {
            id: todos.length > 0 ? Math.max(...todos.map((t) => t.id)) + 1 : 1,
            text,
            done: false,
            createdAt: new Date().toISOString(),
          };
          todos.push(newTodo);
          await saveTodos(todos);
          return {
            content: [
              {
                type: "text" as const,
                text: `Added todo #${newTodo.id}: "${text}"`,
              },
            ],
          };
        }
        case "complete": {
          const todo = todos.find((t) => t.id === id);
          if (!todo) {
            return {
              content: [{ type: "text" as const, text: `Todo #${id} not found.` }],
            };
          }
          todo.done = true;
          await saveTodos(todos);
          return {
            content: [
              { type: "text" as const, text: `Completed todo #${id}: "${todo.text}"` },
            ],
          };
        }
        case "remove": {
          const index = todos.findIndex((t) => t.id === id);
          if (index === -1) {
            return {
              content: [{ type: "text" as const, text: `Todo #${id} not found.` }],
            };
          }
          const removed = todos.splice(index, 1)[0];
          await saveTodos(todos);
          return {
            content: [
              { type: "text" as const, text: `Removed todo #${id}: "${removed.text}"` },
            ],
          };
        }
        case "list": {
          if (todos.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No todos yet. Add one!" }],
            };
          }
          const list = todos
            .map((t) => `${t.done ? "[x]" : "[ ]"} #${t.id} — ${t.text}`)
            .join("\n");
          return {
            content: [
              {
                type: "text" as const,
                text: `## Todos\n\n${list}\n\n**Total:** ${todos.length} | **Done:** ${todos.filter((t) => t.done).length}`,
              },
            ],
          };
        }
      }
    }
  );

  // --- summarize_url ---
  server.tool(
    "summarize_url",
    "Fetch a public URL and return its text content (HTML stripped to plain text). Internal/private addresses are blocked.",
    {
      url: z.string().max(MAX_STRING_LENGTH).describe("The URL to fetch and summarize (must be public, http/https only)"),
      maxLength: z
        .number()
        .int()
        .min(100)
        .max(100000)
        .default(5000)
        .describe("Maximum character length of returned content"),
    },
    async ({ url, maxLength }) => {
      // SSRF protection
      const urlCheck = validateUrl(url);
      if (!urlCheck.valid) {
        return {
          content: [{ type: "text" as const, text: `Error: ${urlCheck.error}` }],
        };
      }

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        const html = await response.text();

        // Basic HTML to text conversion
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, " ")
          .trim();

        const truncated = text.substring(0, maxLength);

        return {
          content: [
            {
              type: "text" as const,
              text: `## Content from ${url}\n\n${truncated}${text.length > maxLength ? "\n\n... (truncated)" : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `Failed to fetch URL: ${sanitizeError(error)}` },
          ],
        };
      }
    }
  );

  // --- send_notification ---
  server.tool(
    "send_notification",
    "Send a macOS desktop notification.",
    {
      title: z.string().max(200).describe("Notification title"),
      message: z.string().max(1000).describe("Notification body text"),
      sound: z
        .boolean()
        .default(true)
        .describe("Play a sound with the notification"),
    },
    async ({ title, message, sound }) => {
      try {
        // Sanitize inputs — strip everything except safe characters
        const safeTitle = title.replace(/[^a-zA-Z0-9 _\-.,!?:;()]/g, "");
        const safeMessage = message.replace(/[^a-zA-Z0-9 _\-.,!?:;()\n]/g, "");

        const soundClause = sound ? 'sound name "default"' : "";
        const script = `display notification "${safeMessage}" with title "${safeTitle}" ${soundClause}`;

        // Use execFile with explicit args — no shell interpolation
        await execFileAsync("osascript", ["-e", script], { timeout: 5000 });

        return {
          content: [
            {
              type: "text" as const,
              text: `Notification sent: **${safeTitle}** — ${safeMessage}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `Notification error: ${sanitizeError(error)}` },
          ],
        };
      }
    }
  );
}
