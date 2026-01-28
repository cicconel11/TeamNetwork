/**
 * Validates a new password and its confirmation.
 * Returns an error message string, or null if valid.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (password.length < 6) {
    return "Password must be at least 6 characters";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
