/**
 * Shared display helpers for role badges and labels.
 * Used by invite panels, membership panels, and approval pages.
 */

export function getRoleBadgeVariant(role: string): "warning" | "muted" | "primary" {
  switch (role) {
    case "admin": return "warning";
    case "alumni": return "muted";
    case "parent": return "primary";
    default: return "primary";
  }
}

export function getRoleLabel(role: string): string {
  switch (role) {
    case "admin": return "Admin";
    case "alumni": return "Alumni";
    case "parent": return "Parent";
    case "active_member": return "Active Member";
    case "member": return "Member";
    default: return role;
  }
}
