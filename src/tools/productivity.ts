import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

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
  await writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
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
      text: z.string().optional().describe("Todo text (required for 'add')"),
      id: z.number().optional().describe("Todo ID (required for 'complete' and 'remove')"),
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
    "Fetch a URL and return its text content (HTML stripped to plain text).",
    {
      url: z.string().describe("The URL to fetch and summarize"),
      maxLength: z
        .number()
        .default(5000)
        .describe("Maximum character length of returned content"),
    },
    async ({ url, maxLength }) => {
      try {
        const response = await fetch(url);
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
            { type: "text" as const, text: `Failed to fetch ${url}: ${error.message}` },
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
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification body text"),
      sound: z
        .boolean()
        .default(true)
        .describe("Play a sound with the notification"),
    },
    async ({ title, message, sound }) => {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        const soundFlag = sound ? 'sound name "default"' : "";
        await execAsync(
          `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" ${soundFlag}'`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Notification sent: **${title}** — ${message}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `Notification error: ${error.message}` },
          ],
        };
      }
    }
  );
}
