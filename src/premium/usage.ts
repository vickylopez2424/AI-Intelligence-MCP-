import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { LicenseTier } from "./license.js";

const USAGE_FILE = join(homedir(), ".claudeworker-usage.json");

export interface UsageRecord {
  toolName: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
}

export interface UsageData {
  dailyCounts: Record<string, number>; // "2024-01-15" -> count
  toolCounts: Record<string, number>; // "fetch_api" -> total calls
  history: UsageRecord[]; // Last 1000 calls
  totalCalls: number;
  firstCall: string;
}

// Usage limits per tier (calls per day)
const DAILY_LIMITS: Record<LicenseTier, number> = {
  free: 50,
  pro: 1000,
  enterprise: Infinity,
};

// Per-tool limits per day (free tier)
const FREE_TOOL_LIMITS: Record<string, number> = {
  system_health: 20,
  port_scan: 10,
  ascii_art: 20,
  manage_todos: 50,
  search_docs: 15,
  git_status: 15,
  git_log: 10,
  color_palette: 15,
};

async function loadUsage(): Promise<UsageData> {
  try {
    const content = await readFile(USAGE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      dailyCounts: {},
      toolCounts: {},
      history: [],
      totalCalls: 0,
      firstCall: new Date().toISOString(),
    };
  }
}

async function saveUsage(data: UsageData): Promise<void> {
  await writeFile(USAGE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// --- Usage tracking ---

export async function trackUsage(
  toolName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  const data = await loadUsage();
  const date = today();

  // Update daily counts
  data.dailyCounts[date] = (data.dailyCounts[date] || 0) + 1;

  // Update tool counts
  data.toolCounts[toolName] = (data.toolCounts[toolName] || 0) + 1;

  // Add to history (keep last 1000)
  data.history.push({
    toolName,
    timestamp: new Date().toISOString(),
    durationMs,
    success,
  });
  if (data.history.length > 1000) {
    data.history = data.history.slice(-1000);
  }

  data.totalCalls++;

  // Clean up old daily counts (keep 30 days)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  for (const date of Object.keys(data.dailyCounts)) {
    if (date < cutoff) delete data.dailyCounts[date];
  }

  await saveUsage(data);
}

// --- Rate limiting ---

export async function checkRateLimit(
  toolName: string,
  tier: LicenseTier
): Promise<{ allowed: boolean; error?: string; remaining?: number }> {
  const data = await loadUsage();
  const date = today();
  const dailyCount = data.dailyCounts[date] || 0;
  const dailyLimit = DAILY_LIMITS[tier];

  if (dailyCount >= dailyLimit) {
    return {
      allowed: false,
      error: `Daily limit reached (${dailyLimit} calls/day on ${tier} tier). Upgrade for more.`,
      remaining: 0,
    };
  }

  // Check per-tool limits for free tier
  if (tier === "free") {
    const toolLimit = FREE_TOOL_LIMITS[toolName];
    if (toolLimit) {
      const toolDailyCount = data.history.filter(
        (h) => h.toolName === toolName && h.timestamp.startsWith(date)
      ).length;
      if (toolDailyCount >= toolLimit) {
        return {
          allowed: false,
          error: `Daily limit for '${toolName}' reached (${toolLimit}/day on free tier). Upgrade to Pro for higher limits.`,
          remaining: 0,
        };
      }
    }
  }

  return { allowed: true, remaining: dailyLimit - dailyCount };
}

// --- Usage stats ---

export async function getUsageStats(): Promise<{
  today: number;
  total: number;
  topTools: [string, number][];
  last7Days: Record<string, number>;
}> {
  const data = await loadUsage();
  const date = today();

  const topTools = Object.entries(data.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Last 7 days
  const last7Days: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    last7Days[d] = data.dailyCounts[d] || 0;
  }

  return {
    today: data.dailyCounts[date] || 0,
    total: data.totalCalls,
    topTools,
    last7Days,
  };
}
