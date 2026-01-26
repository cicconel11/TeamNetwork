/**
 * useAuth hook
 * Re-exports from AuthContext for centralized auth state management.
 * Eliminates redundant getSession()/getUser() calls across the app.
 */

export { useAuth, useAuthOptional } from "@/contexts/AuthContext";
export type { AuthContextValue } from "@/contexts/AuthContext";
