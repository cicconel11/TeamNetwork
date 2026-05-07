/**
 * Validates an organization name.
 * Requirements 1.3, 1.4: Name must be non-empty after trim and ≤ 100 characters.
 */
export function validateOrgName(name: string): { valid: boolean; error?: string } {
    const trimmed = name.trim();
    if (!trimmed) {
        return { valid: false, error: "Organization name cannot be empty" };
    }
    if (trimmed.length > 100) {
        return { valid: false, error: "Organization name must be under 100 characters" };
    }
    return { valid: true };
}
