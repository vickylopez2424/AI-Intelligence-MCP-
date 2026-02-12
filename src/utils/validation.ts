import { stat } from "fs/promises";
import { resolve } from "path";
import { URL } from "url";

// --- Input length limits ---
export const MAX_STRING_LENGTH = 10000;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// --- Shell safety ---

/** Validate a string contains only safe characters for use as a name/identifier */
export function validateName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/** Validate a Docker container name/ID */
export function validateContainerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/** Validate a file extension (no shell metacharacters) */
export function validateFileExtension(ext: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(ext);
}

/** Validate a port number */
export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// --- Path validation ---

/** Resolve and validate a file path exists and is within allowed boundaries */
export async function validateFilePath(
  filePath: string,
  options: { mustExist?: boolean; maxSize?: number; allowedExtensions?: string[] } = {}
): Promise<{ valid: boolean; error?: string; resolvedPath: string }> {
  const resolvedPath = resolve(filePath);

  // Block sensitive paths
  const blockedPaths = [
    "/etc/shadow",
    "/etc/sudoers",
    "/proc/",
    "/sys/",
  ];
  for (const blocked of blockedPaths) {
    if (resolvedPath.startsWith(blocked) || resolvedPath === blocked.replace(/\/$/, "")) {
      return { valid: false, error: `Access denied: ${resolvedPath}`, resolvedPath };
    }
  }

  // Block hidden directories that commonly contain secrets
  const parts = resolvedPath.split("/");
  const sensitiveNames = [".ssh", ".gnupg", ".aws", ".azure", ".gcloud"];
  for (const part of parts) {
    if (sensitiveNames.includes(part)) {
      return { valid: false, error: `Access denied: path contains sensitive directory '${part}'`, resolvedPath };
    }
  }

  if (options.allowedExtensions) {
    const ext = resolvedPath.split(".").pop()?.toLowerCase() || "";
    if (!options.allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `File extension '.${ext}' not allowed. Allowed: ${options.allowedExtensions.join(", ")}`,
        resolvedPath,
      };
    }
  }

  if (options.mustExist) {
    try {
      const fileStats = await stat(resolvedPath);
      if (options.maxSize && fileStats.size > options.maxSize) {
        return {
          valid: false,
          error: `File too large: ${(fileStats.size / 1024 / 1024).toFixed(1)} MB (max ${(options.maxSize / 1024 / 1024).toFixed(1)} MB)`,
          resolvedPath,
        };
      }
    } catch {
      return { valid: false, error: `File not found: ${resolvedPath}`, resolvedPath };
    }
  }

  return { valid: true, resolvedPath };
}

/** Validate a directory path exists and is a directory */
export async function validateDirectory(
  directory: string
): Promise<{ valid: boolean; error?: string; resolvedPath: string }> {
  const resolvedPath = resolve(directory);

  try {
    const dirStats = await stat(resolvedPath);
    if (!dirStats.isDirectory()) {
      return { valid: false, error: `Not a directory: ${resolvedPath}`, resolvedPath };
    }
  } catch {
    return { valid: false, error: `Directory not found: ${resolvedPath}`, resolvedPath };
  }

  return { valid: true, resolvedPath };
}

// --- URL / SSRF protection ---

/** List of private/internal IP ranges to block */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                     // Loopback
  /^10\./,                      // Private Class A
  /^172\.(1[6-9]|2\d|3[01])\./, // Private Class B
  /^192\.168\./,                // Private Class C
  /^169\.254\./,                // Link-local
  /^0\./,                       // Current network
  /^::1$/,                      // IPv6 loopback
  /^fd[0-9a-f]{2}:/i,           // IPv6 ULA
  /^fe80:/i,                    // IPv6 link-local
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
];

/** Validate a URL is safe (not targeting internal resources) */
export function validateUrl(urlString: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }

  // Only allow http/https
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: `Protocol '${parsed.protocol}' not allowed. Use http or https.` };
  }

  // Block known internal hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: `Hostname '${hostname}' is blocked (internal resource)` };
  }

  // Block private IPs
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: `IP address '${hostname}' is blocked (private/internal range)` };
    }
  }

  // Block cloud metadata endpoints (AWS, GCP, Azure)
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    return { valid: false, error: "Cloud metadata endpoint blocked" };
  }

  return { valid: true };
}

// --- Error sanitization ---

/** Sanitize an error message to avoid leaking sensitive info */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Strip file paths from stack traces
    let msg = error.message;
    // Remove absolute paths beyond the project
    msg = msg.replace(/\/Users\/[^\s:]+/g, "[path hidden]");
    // Remove stack traces
    msg = msg.replace(/\n\s+at\s+.*/g, "");
    return msg;
  }
  return "An unexpected error occurred";
}
