const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_REQUIREMENTS =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;

/**
 * Checks if a password meets minimum length requirements.
 * Used by Zod schemas for validation.
 */
export function isStrongPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

/**
 * Validates a new password and its confirmation.
 * Returns an error message string, or null if valid.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
