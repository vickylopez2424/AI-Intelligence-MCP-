import { createHash, randomBytes } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export type LicenseTier = "free" | "pro" | "enterprise";

export interface License {
  key: string;
  tier: LicenseTier;
  email: string;
  issuedAt: string;
  expiresAt: string;
  features: string[];
}

const LICENSE_FILE = join(homedir(), ".claudeworker-license.json");

// Tool-to-tier mapping: which tools require which tier
const TOOL_TIERS: Record<string, LicenseTier> = {
  // Free tools
  system_health: "free",
  port_scan: "free",
  ascii_art: "free",
  manage_todos: "free",
  search_docs: "free",
  git_status: "free",
  git_log: "free",
  color_palette: "free",

  // Pro tools
  run_tests: "pro",
  lint_code: "pro",
  scaffold_project: "pro",
  fetch_api: "pro",
  parse_csv: "pro",
  transform_json: "pro",
  summarize_url: "pro",
  send_notification: "pro",
  docker_manage: "pro",
  log_analyzer: "pro",
  git_diff: "pro",
  git_branch: "pro",
  repo_stats: "pro",
  image_prompt: "pro",
  test_coverage: "pro",
  benchmark: "pro",

  // Enterprise tools
  query_database: "enterprise",
  schema_inspector: "enterprise",
  export_data: "enterprise",
  ci_status: "enterprise",
};

const TIER_HIERARCHY: Record<LicenseTier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

// --- License key generation ---

const LICENSE_SECRET = "ai-intelligence-mcp-v1"; // In production, use env var

export function generateLicenseKey(tier: LicenseTier, email: string, daysValid: number = 365): License {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000).toISOString();

  const payload = `${tier}:${email}:${issuedAt}:${expiresAt}`;
  const signature = createHash("sha256")
    .update(payload + LICENSE_SECRET)
    .digest("hex")
    .substring(0, 16);

  const random = randomBytes(4).toString("hex");
  const key = `AIMCP-${tier.toUpperCase()}-${random}-${signature}`.toUpperCase();

  const features = Object.entries(TOOL_TIERS)
    .filter(([, t]) => TIER_HIERARCHY[t] <= TIER_HIERARCHY[tier])
    .map(([name]) => name);

  return { key, tier, email, issuedAt, expiresAt, features };
}

// --- License validation ---

export function validateLicenseKey(license: License): { valid: boolean; error?: string } {
  // Check expiration
  if (new Date(license.expiresAt) < new Date()) {
    return { valid: false, error: "License has expired" };
  }

  // Check key format
  if (!license.key.startsWith("AIMCP-")) {
    return { valid: false, error: "Invalid license key format" };
  }

  return { valid: true };
}

// --- License storage ---

export async function loadLicense(): Promise<License | null> {
  try {
    const content = await readFile(LICENSE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveLicense(license: License): Promise<void> {
  await writeFile(LICENSE_FILE, JSON.stringify(license, null, 2), { mode: 0o600 });
}

// --- Tool access control ---

export function getRequiredTier(toolName: string): LicenseTier {
  return TOOL_TIERS[toolName] || "enterprise";
}

export function canAccessTool(userTier: LicenseTier, toolName: string): boolean {
  const requiredTier = getRequiredTier(toolName);
  return TIER_HIERARCHY[userTier] >= TIER_HIERARCHY[requiredTier];
}

export function getCurrentTier(license: License | null): LicenseTier {
  if (!license) return "free";
  const validation = validateLicenseKey(license);
  if (!validation.valid) return "free";
  return license.tier;
}

// --- Tool tier info for display ---

export function getToolsByTier(): Record<LicenseTier, string[]> {
  const result: Record<LicenseTier, string[]> = { free: [], pro: [], enterprise: [] };
  for (const [tool, tier] of Object.entries(TOOL_TIERS)) {
    result[tier].push(tool);
  }
  return result;
}
