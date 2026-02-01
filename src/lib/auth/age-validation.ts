import { createHmac } from "crypto";
import type { AgeBracket } from "@/lib/schemas/age-gate";

const TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  const secret = process.env.AGE_VALIDATION_SECRET;
  if (!secret) {
    throw new Error("AGE_VALIDATION_SECRET environment variable is required");
  }
  return secret;
}

interface AgeValidationPayload {
  ageBracket: AgeBracket;
  isMinor: boolean;
  validatedAt: number;
  expiresAt: number;
}

interface AgeValidationTokenData extends AgeValidationPayload {
  hash: string;
}

/**
 * Create a signed token proving age validation occurred.
 * Token expires in 10 minutes.
 */
export function createAgeValidationToken(
  ageBracket: AgeBracket
): string {
  const validatedAt = Date.now();
  const expiresAt = validatedAt + TOKEN_EXPIRY_MS;
  const isMinor = ageBracket !== "18_plus";

  const payload: AgeValidationPayload = {
    ageBracket,
    isMinor,
    validatedAt,
    expiresAt,
  };

  const hash = createHmac("sha256", getSecret())
    .update(JSON.stringify(payload))
    .digest("hex");

  const tokenData: AgeValidationTokenData = { ...payload, hash };
  return Buffer.from(JSON.stringify(tokenData)).toString("base64");
}

export interface AgeValidationResult {
  valid: boolean;
  ageBracket?: AgeBracket;
  isMinor?: boolean;
  error?: string;
}

/**
 * Verify an age validation token.
 * Returns validation result with age data if valid.
 */
export function verifyAgeValidationToken(token: string): AgeValidationResult {
  try {
    const decoded: AgeValidationTokenData = JSON.parse(
      Buffer.from(token, "base64").toString("utf8")
    );

    const { ageBracket, isMinor, validatedAt, expiresAt, hash } = decoded;
    const derivedIsMinor = ageBracket !== "18_plus";

    // Verify not expired
    if (Date.now() > expiresAt) {
      return { valid: false, error: "Token expired" };
    }

    // Verify signature
    const payload: AgeValidationPayload = {
      ageBracket,
      isMinor,
      validatedAt,
      expiresAt,
    };
    const expectedHash = createHmac("sha256", getSecret())
      .update(JSON.stringify(payload))
      .digest("hex");

    if (hash !== expectedHash) {
      return { valid: false, error: "Invalid signature" };
    }

    if (isMinor !== derivedIsMinor) {
      return { valid: false, error: "Invalid token data" };
    }

    // Reject under_13 (until parental consent is implemented)
    if (ageBracket === "under_13") {
      return { valid: false, error: "Parental consent required" };
    }

    return { valid: true, ageBracket, isMinor };
  } catch {
    return { valid: false, error: "Invalid token format" };
  }
}

/**
 * Valid age bracket values for validation
 */
export const VALID_AGE_BRACKETS: AgeBracket[] = [
  "under_13",
  "13_17",
  "18_plus",
];

/**
 * Check if a value is a valid age bracket
 */
export function isValidAgeBracket(value: unknown): value is AgeBracket {
  return (
    typeof value === "string" &&
    VALID_AGE_BRACKETS.includes(value as AgeBracket)
  );
}
