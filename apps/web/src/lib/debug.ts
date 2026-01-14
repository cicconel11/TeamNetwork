const isDebug =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_DEBUG === "true"
    : typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__NEXT_DATA__?.runtimeConfig?.NEXT_PUBLIC_DEBUG === "true";

/**
 * Conditional debug logger. No-op unless NEXT_PUBLIC_DEBUG=true.
 * Output format: [debug][tag] ...args
 */
export function debugLog(tag: string, ...args: unknown[]): void {
  if (!isDebug) return;
  console.log(`[debug][${tag}]`, ...args);
}

const PII_KEYS = new Set([
  "email",
  "token",
  "userId",
  "user_id",
  "password",
  "secret",
  "key",
]);

/**
 * Mask PII values for safe logging.
 * - Emails: u***@e***.com
 * - UUIDs (36 chars with dashes): first 8 chars + ...
 * - Other strings: first 4 chars + ...
 */
export function maskPII(value: unknown): string {
  if (typeof value !== "string") return String(value);

  // Email pattern
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    const domainParts = domain.split(".");
    const ext = domainParts.pop() || "";
    return `${local[0]}***@${domainParts[0]?.[0] ?? ""}***.${ext}`;
  }

  // UUID pattern (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) {
    return value.slice(0, 8) + "...";
  }

  // Generic token/secret
  if (value.length > 4) {
    return value.slice(0, 4) + "...";
  }

  return value;
}

/**
 * Iterate object keys and mask values for keys that look like PII.
 * Returns a new object safe for logging.
 */
export function safeLogParams(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isPII = [...PII_KEYS].some((piiKey) => lowerKey.includes(piiKey.toLowerCase()));
    result[key] = isPII ? maskPII(value) : value;
  }
  return result;
}
