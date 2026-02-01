const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REGEX = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /[0-9]/,
  special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
};

export const PASSWORD_REQUIREMENTS =
  "Password must be at least 12 characters and include uppercase, lowercase, number, and special character";

/**
 * Checks if a password meets NIST-compliant complexity requirements.
 * Used by Zod schemas for validation.
 */
export function isStrongPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_REGEX.uppercase.test(password) &&
    PASSWORD_REGEX.lowercase.test(password) &&
    PASSWORD_REGEX.number.test(password) &&
    PASSWORD_REGEX.special.test(password)
  );
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
  if (!PASSWORD_REGEX.uppercase.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!PASSWORD_REGEX.lowercase.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!PASSWORD_REGEX.number.test(password)) {
    return "Password must contain at least one number";
  }
  if (!PASSWORD_REGEX.special.test(password)) {
    return "Password must contain at least one special character";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
