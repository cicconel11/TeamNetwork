import { Image, Text, View } from "react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";

export function OrgHeaderLogo() {
  const { orgLogoUrl, orgName, orgSlug } = useOrg();
  const { colors } = useOrgTheme();
  const initial = (orgName ?? orgSlug ?? "").trim().charAt(0).toUpperCase();
  const fallbackInitial = initial || "O";
  const size = 28;
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: 6,
    borderCurve: "continuous" as const,
    backgroundColor: colors.primaryLight,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };

  if (orgLogoUrl) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: orgLogoUrl }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primaryDark }}>
        {fallbackInitial}
      </Text>
    </View>
  );
}
