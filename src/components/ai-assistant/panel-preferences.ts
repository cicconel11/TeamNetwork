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
