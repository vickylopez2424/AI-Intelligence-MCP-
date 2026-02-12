import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import {
  validateFilePath,
  validateUrl,
  sanitizeError,
  MAX_STRING_LENGTH,
  MAX_FILE_SIZE,
} from "../utils/validation.js";

// Safe JSON path accessor — supports dot notation and array indexing only
function safeJsonAccess(data: unknown, path: string): unknown {
  const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
  let current: any = data;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

// Safe operations that can be applied to extracted data
const SAFE_OPERATIONS: Record<string, (data: any) => any> = {
  keys: (d) => (typeof d === "object" && d !== null ? Object.keys(d) : []),
  values: (d) => (typeof d === "object" && d !== null ? Object.values(d) : []),
  length: (d) => (Array.isArray(d) ? d.length : typeof d === "string" ? d.length : 0),
  flatten: (d) => (Array.isArray(d) ? d.flat() : d),
  unique: (d) => (Array.isArray(d) ? [...new Set(d)] : d),
  sort: (d) => (Array.isArray(d) ? [...d].sort() : d),
  reverse: (d) => (Array.isArray(d) ? [...d].reverse() : d),
  first: (d) => (Array.isArray(d) ? d[0] : d),
  last: (d) => (Array.isArray(d) ? d[d.length - 1] : d),
};

export function registerDataTools(server: McpServer) {
  // --- fetch_api ---
  server.tool(
    "fetch_api",
    "Make an HTTP request to any public REST API and return the response. Internal/private network addresses are blocked.",
    {
      url: z.string().max(MAX_STRING_LENGTH).describe("The URL to fetch (must be public, http/https only)"),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Request headers as key-value pairs"),
      body: z.string().max(MAX_STRING_LENGTH).optional().describe("Request body (for POST/PUT/PATCH)"),
    },
    async ({ url, method, headers, body }) => {
      // SSRF protection
      const urlCheck = validateUrl(url);
      if (!urlCheck.valid) {
        return {
          content: [{ type: "text" as const, text: `Error: ${urlCheck.error}` }],
        };
      }

      try {
        const options: RequestInit = {
          method,
          headers: headers ? new Headers(headers) : undefined,
          body: method !== "GET" && method !== "DELETE" ? body : undefined,
          signal: AbortSignal.timeout(30000),
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

        // Truncate large responses
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
              text: `## API Error\n\n**${method}** ${url}\n\nError: ${sanitizeError(error)}`,
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
      filePath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the CSV file"),
      delimiter: z.string().max(5).default(",").describe("Column delimiter"),
      maxRows: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(100)
        .describe("Maximum number of rows to return"),
    },
    async ({ filePath, delimiter, maxRows }) => {
      try {
        const pathCheck = await validateFilePath(filePath, {
          mustExist: true,
          maxSize: MAX_FILE_SIZE,
          allowedExtensions: ["csv", "tsv", "txt"],
        });
        if (!pathCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
        }

        const content = await readFile(pathCheck.resolvedPath, "utf-8");
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
              text: `## CSV Parsed\n\n**File:** ${pathCheck.resolvedPath}\n**Headers:** ${headers.join(", ")}\n**Rows:** ${rows.length} of ${lines.length - 1} total\n\n\`\`\`json\n${JSON.stringify(rows.slice(0, 20), null, 2)}\n\`\`\`\n${rows.length > 20 ? `\n... and ${rows.length - 20} more rows` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## CSV Parse Error\n\n${sanitizeError(error)}` },
          ],
        };
      }
    }
  );

  // --- transform_json ---
  server.tool(
    "transform_json",
    "Read a JSON file and extract data using a dot-notation path, with optional operations (keys, values, length, flatten, unique, sort, reverse, first, last).",
    {
      filePath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the JSON file"),
      path: z
        .string()
        .max(500)
        .describe(
          "Dot-notation path to extract, e.g. 'users', 'data.items', 'records[0].name'. Use '.' for the root."
        ),
      operation: z
        .enum(["keys", "values", "length", "flatten", "unique", "sort", "reverse", "first", "last"])
        .optional()
        .describe("Optional operation to apply to the extracted data"),
    },
    async ({ filePath, path, operation }) => {
      try {
        const pathCheck = await validateFilePath(filePath, {
          mustExist: true,
          maxSize: MAX_FILE_SIZE,
          allowedExtensions: ["json"],
        });
        if (!pathCheck.valid) {
          return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
        }

        const content = await readFile(pathCheck.resolvedPath, "utf-8");
        const data = JSON.parse(content);

        // Use safe path accessor instead of Function constructor
        let result = path === "." ? data : safeJsonAccess(data, path);

        // Apply safe operation if specified
        if (operation && SAFE_OPERATIONS[operation]) {
          result = SAFE_OPERATIONS[operation](result);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## JSON Transform Result\n\n**File:** ${pathCheck.resolvedPath}\n**Path:** \`${path}\`${operation ? `\n**Operation:** \`${operation}\`` : ""}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Transform Error\n\n${sanitizeError(error)}` },
          ],
        };
      }
    }
  );
}
