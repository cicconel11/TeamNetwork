/**
 * Shared Supabase configuration constants and utilities
 */

export const EXPECTED_PROJECT_REF = "rytsziwekhtjdqzzpdso";

/**
 * Asserts that an environment variable is defined and non-empty
 */
export function assertEnvValue(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required Supabase environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Validates that a Supabase URL contains the expected project reference
 */
export function validateProjectRef(url: string): boolean {
  return url.includes(EXPECTED_PROJECT_REF);
}
