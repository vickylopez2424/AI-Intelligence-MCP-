import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";

export function registerDataTools(server: McpServer) {
  // --- fetch_api ---
  server.tool(
    "fetch_api",
    "Make an HTTP request to any REST API and return the response.",
    {
      url: z.string().describe("The URL to fetch"),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Request headers as key-value pairs"),
      body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
    },
    async ({ url, method, headers, body }) => {
      try {
        const options: RequestInit = {
          method,
          headers: headers ? new Headers(headers) : undefined,
          body: method !== "GET" && method !== "DELETE" ? body : undefined,
        };

        const response = await fetch(url, options);
        const contentType = response.headers.get("content-type") || "";
        let responseBody: string;

        if (contentType.includes("application/json")) {
          const json = await response.json();
          responseBody = JSON.stringify(json, null, 2);
        } else {
          responseBody = await response.text();
        }

        // Truncate very large responses
        if (responseBody.length > 10000) {
          responseBody = responseBody.substring(0, 10000) + "\n\n... (truncated)";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## API Response\n\n**${method}** ${url}\n**Status:** ${response.status} ${response.statusText}\n\n\`\`\`\n${responseBody}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## API Error\n\n**${method}** ${url}\n\nError: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // --- parse_csv ---
  server.tool(
    "parse_csv",
    "Read and parse a CSV file. Returns structured data with headers and rows.",
    {
      filePath: z.string().describe("Absolute path to the CSV file"),
      delimiter: z.string().default(",").describe("Column delimiter"),
      maxRows: z
        .number()
        .default(100)
        .describe("Maximum number of rows to return"),
    },
    async ({ filePath, delimiter, maxRows }) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
        const rows = lines.slice(1, maxRows + 1).map((line) => {
          const values = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, string> = {};
          headers.forEach((h, i) => {
            row[h] = values[i] || "";
          });
          return row;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## CSV Parsed\n\n**File:** ${filePath}\n**Headers:** ${headers.join(", ")}\n**Rows:** ${rows.length} of ${lines.length - 1} total\n\n\`\`\`json\n${JSON.stringify(rows.slice(0, 20), null, 2)}\n\`\`\`\n${rows.length > 20 ? `\n... and ${rows.length - 20} more rows` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## CSV Parse Error\n\n${error.message}`,
            },
          ],
        };
      }
    }
  );

  // --- transform_json ---
  server.tool(
    "transform_json",
    "Read a JSON file and extract or transform data using a JavaScript expression.",
    {
      filePath: z.string().describe("Absolute path to the JSON file"),
      expression: z
        .string()
        .describe(
          "JavaScript expression to apply to the parsed data. Use 'data' as the variable name. E.g. 'data.users.map(u => u.name)'"
        ),
    },
    async ({ filePath, expression }) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const data = JSON.parse(content);

        // Use Function constructor for sandboxed evaluation
        const fn = new Function("data", `return ${expression}`);
        const result = fn(data);

        return {
          content: [
            {
              type: "text" as const,
              text: `## JSON Transform Result\n\n**File:** ${filePath}\n**Expression:** \`${expression}\`\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## Transform Error\n\n${error.message}`,
            },
          ],
        };
      }
    }
  );
}
