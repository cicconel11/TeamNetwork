import { useMemo } from "react";
import { useOrg } from "@/contexts/OrgContext";
import { buildOrgTheme, type ThemeColors } from "@/lib/theme";

export function useOrgTheme(): { colors: ThemeColors } {
  const { orgPrimaryColor, orgSecondaryColor } = useOrg();

  const orgColors = useMemo(
    () => buildOrgTheme(orgPrimaryColor, orgSecondaryColor),
    [orgPrimaryColor, orgSecondaryColor]
  );

  return { colors: orgColors };
}
