import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { writeFile } from "fs/promises";
import {
  validateFilePath,
  sanitizeError,
  MAX_STRING_LENGTH,
} from "../utils/validation.js";

// Blocklisted SQL operations for safety
const DANGEROUS_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b.*\bDROP\b/i,
  /\bDELETE\s+FROM\b.*\bWHERE\s+1\s*=\s*1\b/i,
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bload_extension\b/i,
];

function isSafeQuery(sql: string): { safe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sql)) {
      return { safe: false, reason: `Blocked operation detected: ${pattern.source}` };
    }
  }
  return { safe: true };
}

export function registerDatabaseTools(server: McpServer) {
  // --- query_database ---
  server.tool(
    "query_database",
    "Execute a SQL query against a SQLite database. Supports SELECT, INSERT, UPDATE, DELETE, CREATE TABLE. Destructive operations (DROP, TRUNCATE) are blocked.",
    {
      dbPath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the SQLite database file"),
      query: z.string().max(MAX_STRING_LENGTH).describe("SQL query to execute"),
      params: z
        .array(z.union([z.string(), z.number(), z.null()]))
        .optional()
        .describe("Query parameters for prepared statements (use ? placeholders)"),
    },
    async ({ dbPath, query, params }) => {
      const pathCheck = await validateFilePath(dbPath, {
        allowedExtensions: ["db", "sqlite", "sqlite3"],
      });
      if (!pathCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
      }

      const safeCheck = isSafeQuery(query);
      if (!safeCheck.safe) {
        return {
          content: [{ type: "text" as const, text: `Error: ${safeCheck.reason}` }],
        };
      }

      let db: Database.Database | null = null;
      try {
        db = new Database(pathCheck.resolvedPath);

        const trimmed = query.trim().toUpperCase();
        const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");

        if (isSelect) {
          const rows = db.prepare(query).all(...(params || []));
          const count = rows.length;
          const display = rows.slice(0, 50);

          return {
            content: [
              {
                type: "text" as const,
                text: `## Query Results\n\n**Query:** \`${query}\`\n**Rows:** ${count}${count > 50 ? " (showing first 50)" : ""}\n\n\`\`\`json\n${JSON.stringify(display, null, 2)}\n\`\`\``,
              },
            ],
          };
        } else {
          const result = db.prepare(query).run(...(params || []));

          return {
            content: [
              {
                type: "text" as const,
                text: `## Query Executed\n\n**Query:** \`${query}\`\n**Changes:** ${result.changes}\n**Last Insert ID:** ${result.lastInsertRowid}`,
              },
            ],
          };
        }
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Query Error\n\n${sanitizeError(error)}` },
          ],
        };
      } finally {
        db?.close();
      }
    }
  );

  // --- schema_inspector ---
  server.tool(
    "schema_inspector",
    "Inspect the schema of a SQLite database — list tables, columns, indexes, and foreign keys.",
    {
      dbPath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the SQLite database file"),
      table: z.string().max(200).optional().describe("Specific table to inspect. If omitted, shows all tables."),
    },
    async ({ dbPath, table }) => {
      const pathCheck = await validateFilePath(dbPath, {
        mustExist: true,
        allowedExtensions: ["db", "sqlite", "sqlite3"],
      });
      if (!pathCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
      }

      let db: Database.Database | null = null;
      try {
        db = new Database(pathCheck.resolvedPath, { readonly: true });

        if (table) {
          // Inspect specific table
          const columns = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as any[];
          const indexes = db.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all() as any[];
          const fkeys = db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all() as any[];

          const colTable = columns
            .map((c) => `| ${c.name} | ${c.type} | ${c.notnull ? "NOT NULL" : "NULL"} | ${c.pk ? "PK" : ""} | ${c.dflt_value ?? ""} |`)
            .join("\n");

          let result = `## Table: ${table}\n\n### Columns\n| Name | Type | Nullable | PK | Default |\n|------|------|----------|----|---------|\n${colTable}`;

          if (indexes.length > 0) {
            const idxTable = indexes
              .map((idx) => `| ${idx.name} | ${idx.unique ? "UNIQUE" : ""} |`)
              .join("\n");
            result += `\n\n### Indexes\n| Name | Unique |\n|------|--------|\n${idxTable}`;
          }

          if (fkeys.length > 0) {
            const fkTable = fkeys
              .map((fk) => `| ${fk.from} | ${fk.table}.${fk.to} |`)
              .join("\n");
            result += `\n\n### Foreign Keys\n| Column | References |\n|--------|------------|\n${fkTable}`;
          }

          return { content: [{ type: "text" as const, text: result }] };
        } else {
          // List all tables
          const tables = db
            .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
            .all() as any[];

          const tableList = tables
            .map((t) => {
              const count = db!.prepare(`SELECT COUNT(*) as c FROM "${t.name.replace(/"/g, '""')}"`).get() as any;
              return `| ${t.name} | ${t.type} | ${count.c} |`;
            })
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `## Database Schema: ${pathCheck.resolvedPath}\n\n| Table | Type | Rows |\n|-------|------|------|\n${tableList}`,
              },
            ],
          };
        }
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Schema Error\n\n${sanitizeError(error)}` },
          ],
        };
      } finally {
        db?.close();
      }
    }
  );

  // --- export_data ---
  server.tool(
    "export_data",
    "Export data from a SQLite table to JSON or CSV format.",
    {
      dbPath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path to the SQLite database file"),
      table: z.string().max(200).describe("Table name to export"),
      format: z.enum(["json", "csv"]).default("json").describe("Export format"),
      outputPath: z.string().max(MAX_STRING_LENGTH).describe("Absolute path for the output file"),
      limit: z.number().int().min(1).max(100000).default(10000).describe("Maximum rows to export"),
    },
    async ({ dbPath, table, format, outputPath, limit }) => {
      const pathCheck = await validateFilePath(dbPath, {
        mustExist: true,
        allowedExtensions: ["db", "sqlite", "sqlite3"],
      });
      if (!pathCheck.valid) {
        return { content: [{ type: "text" as const, text: `Error: ${pathCheck.error}` }] };
      }

      let db: Database.Database | null = null;
      try {
        db = new Database(pathCheck.resolvedPath, { readonly: true });

        // Validate table name (prevent injection)
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .all(table) as any[];
        if (tables.length === 0) {
          return {
            content: [{ type: "text" as const, text: `Error: Table '${table}' not found.` }],
          };
        }

        const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ?`).all(limit) as any[];

        let output: string;
        if (format === "csv") {
          if (rows.length === 0) {
            output = "";
          } else {
            const headers = Object.keys(rows[0]);
            const csvRows = rows.map((row) =>
              headers.map((h) => {
                const val = String(row[h] ?? "");
                return val.includes(",") || val.includes('"') || val.includes("\n")
                  ? `"${val.replace(/"/g, '""')}"`
                  : val;
              }).join(",")
            );
            output = [headers.join(","), ...csvRows].join("\n");
          }
        } else {
          output = JSON.stringify(rows, null, 2);
        }

        await writeFile(outputPath, output, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `## Data Exported\n\n**Table:** ${table}\n**Format:** ${format}\n**Rows:** ${rows.length}\n**Output:** ${outputPath}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `## Export Error\n\n${sanitizeError(error)}` },
          ],
        };
      } finally {
        db?.close();
      }
    }
  );
}
