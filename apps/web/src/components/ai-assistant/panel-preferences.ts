export const AI_PANEL_PREFERENCE_KEY = "ai-panel-preference";

interface ResolveInitialAIPanelOpenInput {
  isAdmin: boolean;
  isDesktop: boolean;
  storedPreference?: string | null;
}

export function resolveInitialAIPanelOpen({
  isAdmin,
  isDesktop,
  storedPreference,
}: ResolveInitialAIPanelOpenInput): boolean {
  if (!isAdmin) {
    return false;
  }

  if (storedPreference === "open") {
    return true;
  }

  if (storedPreference === "closed") {
    return false;
  }

  return isDesktop;
}
