import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { registerDevTools } from "./tools/dev-workflow.js";
import { registerDataTools } from "./tools/data-api.js";
import { registerProductivityTools } from "./tools/productivity.js";
import { registerSystemTools } from "./tools/system-ops.js";
import { registerCreativeTools } from "./tools/creative.js";
import { registerDatabaseTools } from "./tools/database.js";
import { registerGitTools } from "./tools/git-tools.js";
import { registerTestingTools } from "./tools/testing.js";
import {
  loadLicense,
  getCurrentTier,
  getToolsByTier,
  generateLicenseKey,
  saveLicense,
  type LicenseTier,
} from "./premium/license.js";
import { getUsageStats } from "./premium/usage.js";

export function registerAllTools(server: McpServer) {
  // --- Core tool categories ---
  registerDevTools(server);
  registerDataTools(server);
  registerProductivityTools(server);
  registerSystemTools(server);
  registerCreativeTools(server);
  registerDatabaseTools(server);
  registerGitTools(server);
  registerTestingTools(server);

  // --- Premium management tools ---

  server.tool(
    "license_info",
    "View your current license tier, available tools, and upgrade options.",
    {},
    async () => {
      const license = await loadLicense();
      const tier = getCurrentTier(license);
      const toolsByTier = getToolsByTier();

      const freeTools = toolsByTier.free.join(", ");
      const proTools = toolsByTier.pro.join(", ");
      const enterpriseTools = toolsByTier.enterprise.join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `## License Info\n\n**Current Tier:** ${tier.toUpperCase()}\n${license ? `**Key:** ${license.key}\n**Email:** ${license.email}\n**Expires:** ${license.expiresAt}\n` : ""}\n### Free Tools (${toolsByTier.free.length})\n${freeTools}\n\n### Pro Tools (${toolsByTier.pro.length})\n${proTools}\n\n### Enterprise Tools (${toolsByTier.enterprise.length})\n${enterpriseTools}`,
          },
        ],
      };
    }
  );

  server.tool(
    "activate_license",
    "Activate a license key to unlock Pro or Enterprise tools.",
    {
      key: z.string().max(100).describe("License key to activate"),
      email: z.string().max(200).describe("Email associated with the license"),
      tier: z.enum(["pro", "enterprise"]).describe("License tier"),
    },
    async ({ key, email, tier }) => {
      const license = {
        key,
        tier: tier as LicenseTier,
        email,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        features: [],
      };

      await saveLicense(license);

      return {
        content: [
          {
            type: "text" as const,
            text: `## License Activated\n\n**Tier:** ${tier.toUpperCase()}\n**Email:** ${email}\n**Expires:** ${license.expiresAt}\n\nAll ${tier} tools are now unlocked!`,
          },
        ],
      };
    }
  );

  server.tool(
    "usage_stats",
    "View your tool usage statistics — daily counts, top tools, and usage trends.",
    {},
    async () => {
      const stats = await getUsageStats();
      const license = await loadLicense();
      const tier = getCurrentTier(license);

      const topTools = stats.topTools
        .map(([name, count]) => `| ${name} | ${count} |`)
        .join("\n");

      const dailyChart = Object.entries(stats.last7Days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => `| ${date} | ${"█".repeat(Math.min(count, 50))} ${count} |`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Usage Stats\n\n**Tier:** ${tier}\n**Today:** ${stats.today} calls\n**All Time:** ${stats.total} calls\n\n### Last 7 Days\n| Date | Usage |\n|------|-------|\n${dailyChart}\n\n### Top Tools\n| Tool | Calls |\n|------|-------|\n${topTools}`,
          },
        ],
      };
    }
  );
}
