import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  type ListRenderItem,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { MessageCircle, Network, UserRound } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { ErrorState } from "@/components/ui";
import { showToast } from "@/components/ui/Toast";
import { useOrg } from "@/contexts/OrgContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { RADIUS, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  getConnectionSuggestions,
  startConnectionChat,
  type ConnectionMatchStrength,
  type ConnectionPersonType,
  type DisplayReadySuggestedConnection,
} from "@/lib/connections-api";
import { NetworkUnreachableError } from "@/lib/web-api";

const STRENGTH_LABELS: Record<ConnectionMatchStrength, string> = {
  strong: "Strong match",
  good: "Good match",
  suggested: "Suggested",
};

function getRoleLabel(type: ConnectionPersonType) {
  switch (type) {
    case "member":
      return "Member";
    case "alumni":
      return "Alumni";
    case "parent":
      return "Parent";
  }
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return parts[0]?.[0]?.toUpperCase() || "?";
}

export default function ConnectionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isOffline } = useNetwork();
  const [suggestions, setSuggestions] = useState<DisplayReadySuggestedConnection[]>([]);
  const [state, setState] = useState<"ok" | "no_source">("ok");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 44,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      color: APP_CHROME.avatarText,
      letterSpacing: 0,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      letterSpacing: 0,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      letterSpacing: 0,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.md,
      flexGrow: 1,
    },
    intro: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.xs,
    },
    introTitleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    introTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      letterSpacing: 0,
    },
    introText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      letterSpacing: 0,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      ...SHADOWS.sm,
    },
    cardTop: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: s.infoLight,
    },
    avatarText: {
      ...TYPOGRAPHY.titleMedium,
      color: s.infoDark,
      letterSpacing: 0,
    },
    cardMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      letterSpacing: 0,
    },
    subtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      letterSpacing: 0,
    },
    badgeRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.xs,
    },
    badge: {
      paddingVertical: 4,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.full,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
    },
    badgeStrong: {
      backgroundColor: s.successLight,
      borderColor: s.success,
    },
    badgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
      letterSpacing: 0,
    },
    badgeTextStrong: {
      color: s.successDark,
    },
    strengthBadge: {
      alignSelf: "flex-start" as const,
      paddingVertical: 4,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.full,
      backgroundColor: s.infoLight,
    },
    strengthBadgeStrong: {
      backgroundColor: s.successLight,
    },
    strengthBadgeSuggested: {
      backgroundColor: s.warningLight,
    },
    strengthText: {
      ...TYPOGRAPHY.labelSmall,
      color: s.infoDark,
      letterSpacing: 0,
    },
    strengthTextStrong: {
      color: s.successDark,
    },
    strengthTextSuggested: {
      color: s.warningDark,
    },
    button: {
      minHeight: 44,
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    buttonPressed: {
      opacity: 0.82,
    },
    buttonDisabled: {
      backgroundColor: n.disabled,
    },
    buttonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      letterSpacing: 0,
    },
    mutedStatus: {
      minHeight: 44,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: SPACING.md,
    },
    mutedStatusText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
      letterSpacing: 0,
      textAlign: "center" as const,
    },
    centered: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      padding: SPACING.xl,
    },
    loadingText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      letterSpacing: 0,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      letterSpacing: 0,
      textAlign: "center" as const,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      letterSpacing: 0,
      textAlign: "center" as const,
    },
  }));

  const loadSuggestions = useCallback(
    async (isRefresh = false) => {
      if (!orgId) return;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await getConnectionSuggestions(orgId);
        setState(result.state);
        setSuggestions(result.suggestions);
      } catch (loadError) {
        const message =
          loadError instanceof NetworkUnreachableError
            ? "Network request failed"
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load connections.";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useFocusEffect(
    useCallback(() => {
      void loadSuggestions(false);
    }, [loadSuggestions])
  );

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op.
    }
  }, [navigation]);

  const handleRefresh = useCallback(async () => {
    await loadSuggestions(true);
  }, [loadSuggestions]);

  const handleMessage = useCallback(
    async (suggestion: DisplayReadySuggestedConnection) => {
      if (!orgId || !orgSlug) return;
      if (!suggestion.messageable) {
        showToast("This person hasn't linked an app account yet.", "info");
        return;
      }

      const key = `${suggestion.person_type}:${suggestion.person_id}`;
      setOpeningKey(key);
      try {
        const result = await startConnectionChat({
          orgId,
          profileType: suggestion.person_type,
          profileId: suggestion.person_id,
        });
        router.push(`/(app)/${orgSlug}/chat/${result.chatGroupId}`);
      } catch (chatError) {
        const message =
          chatError instanceof Error
            ? chatError.message
            : "Unable to open this conversation.";
        showToast(message, "error");
      } finally {
        setOpeningKey(null);
      }
    },
    [orgId, orgSlug, router]
  );

  const headerMeta = useMemo(() => {
    if (loading && suggestions.length === 0) return "Finding matches";
    if (suggestions.length === 1) return "1 suggestion";
    return `${suggestions.length} suggestions`;
  }, [loading, suggestions.length]);

  const renderHeader = useCallback(
    () => (
      <View style={styles.intro}>
        <View style={styles.introTitleRow}>
          <Network size={18} color={styles.introTitle.color} />
          <Text style={styles.introTitle}>People you should meet</Text>
        </View>
        <Text style={styles.introText}>
          Scored suggestions based on shared industry, company, role, location, and class-year signals.
        </Text>
      </View>
    ),
    [styles.intro, styles.introText, styles.introTitle, styles.introTitleRow]
  );

  const renderEmpty = useCallback(() => {
    const title =
      state === "no_source"
        ? "Complete your profile to get suggestions"
        : "No suggestions yet";
    const subtitle =
      state === "no_source"
        ? "Connections appear once your member or alumni profile is linked to your account."
        : "New people will appear here as more profile details are added.";

    return (
      <View style={styles.centered}>
        <UserRound size={40} color={styles.emptyText.color} />
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyText}>{subtitle}</Text>
      </View>
    );
  }, [state, styles.centered, styles.emptyText, styles.emptyTitle]);

  const renderSuggestion: ListRenderItem<DisplayReadySuggestedConnection> = useCallback(
    ({ item }) => {
      const key = `${item.person_type}:${item.person_id}`;
      const isOpening = openingKey === key;
      const isStrong = item.strength === "strong";
      const isSuggested = item.strength === "suggested";

      return (
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(item.name)}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {item.subtitle}
                </Text>
              ) : (
                <Text style={styles.subtitle}>{getRoleLabel(item.person_type)}</Text>
              )}
            </View>
            <View
              style={[
                styles.strengthBadge,
                isStrong && styles.strengthBadgeStrong,
                isSuggested && styles.strengthBadgeSuggested,
              ]}
            >
              <Text
                style={[
                  styles.strengthText,
                  isStrong && styles.strengthTextStrong,
                  isSuggested && styles.strengthTextSuggested,
                ]}
              >
                {STRENGTH_LABELS[item.strength]}
              </Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{getRoleLabel(item.person_type)}</Text>
            </View>
            {item.reasons.slice(0, 4).map((reason) => (
              <View
                key={`${reason.code}:${reason.detail ?? ""}`}
                style={[styles.badge, reason.strong && styles.badgeStrong]}
              >
                <Text
                  style={[styles.badgeText, reason.strong && styles.badgeTextStrong]}
                  numberOfLines={1}
                >
                  {reason.detail ? `${reason.label}: ${reason.detail}` : reason.label}
                </Text>
              </View>
            ))}
          </View>

          {item.messageable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Message ${item.name}`}
              disabled={isOpening}
              onPress={() => handleMessage(item)}
              style={({ pressed }) => [
                styles.button,
                isOpening && styles.buttonDisabled,
                pressed && !isOpening && styles.buttonPressed,
              ]}
            >
              {isOpening ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <MessageCircle size={18} color="#ffffff" />
              )}
              <Text style={styles.buttonText}>{isOpening ? "Opening" : "Message"}</Text>
            </Pressable>
          ) : (
            <View style={styles.mutedStatus}>
              <Text style={styles.mutedStatusText}>No app account yet</Text>
            </View>
          )}
        </View>
      );
    },
    [
      handleMessage,
      openingKey,
      styles.avatar,
      styles.avatarText,
      styles.badge,
      styles.badgeRow,
      styles.badgeStrong,
      styles.badgeText,
      styles.badgeTextStrong,
      styles.button,
      styles.buttonDisabled,
      styles.buttonPressed,
      styles.buttonText,
      styles.card,
      styles.cardMeta,
      styles.cardTop,
      styles.mutedStatus,
      styles.mutedStatusText,
      styles.name,
      styles.strengthBadge,
      styles.strengthBadgeStrong,
      styles.strengthBadgeSuggested,
      styles.strengthText,
      styles.strengthTextStrong,
      styles.strengthTextSuggested,
      styles.subtitle,
    ]
  );

  const renderContent = () => {
    if (error && suggestions.length === 0) {
      return (
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load connections"
          subtitle={error}
          isOffline={isOffline}
        />
      );
    }

    if (loading && suggestions.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={styles.introTitle.color} />
          <Text style={styles.loadingText}>Finding people you should meet...</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={suggestions}
        keyExtractor={(item) => `${item.person_type}:${item.person_id}`}
        renderItem={renderSuggestion}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Connections</Text>
              <Text style={styles.headerMeta}>{headerMeta}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>{renderContent()}</View>
    </View>
  );
}
