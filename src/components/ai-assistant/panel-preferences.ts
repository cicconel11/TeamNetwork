export const AI_PANEL_PREFERENCE_KEY = "ai-panel-preference";

export type AIPanelPreference = "open" | "closed";

interface ResolveInitialAIPanelOpenInput {
  isAdmin: boolean;
  isDesktop: boolean;
  persisted: string | null;
}

export function resolveInitialAIPanelOpen({
  isAdmin,
  isDesktop,
  persisted,
}: ResolveInitialAIPanelOpenInput): boolean {
  if (!isAdmin) {
    return false;
  }

  if (persisted === "open") {
    return true;
  }

  if (persisted === "closed") {
    return false;
  }

  return isDesktop;
}
