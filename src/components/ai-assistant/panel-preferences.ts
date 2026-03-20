export const AI_PANEL_PREFERENCE_KEY = "ai-panel-preference";

export type AIPanelPreference = "open" | "closed";

interface ResolveInitialAIPanelOpenInput {
  isAdmin: boolean;
  isDesktop: boolean;
  persisted?: string | null;
}

export function resolveInitialAIPanelOpen({
  isAdmin,
  isDesktop,
}: ResolveInitialAIPanelOpenInput): boolean {
  if (!isAdmin) {
    return false;
  }

  return isDesktop;
}
