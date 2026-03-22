export const AI_PANEL_PREFERENCE_KEY = "ai-panel-preference";

interface ResolveInitialAIPanelOpenInput {
  isAdmin: boolean;
  isDesktop: boolean;
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
