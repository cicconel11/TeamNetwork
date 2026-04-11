export const SITE_URL = "https://www.myteamnetwork.com";
export const SITE_NAME = "TeamNetwork";
export const SITE_DESCRIPTION = "Multi-organization hub for members, events, donations, and more";
export const SITE_ICON_VERSION = "tn-20260325b";

export const SITE_ICON_PATHS = {
  favicon: `/favicon.ico?v=${SITE_ICON_VERSION}`,
  icon192: `/icon.png?v=${SITE_ICON_VERSION}`,
  appleTouch: `/apple-icon.png?v=${SITE_ICON_VERSION}`,
} as const;
