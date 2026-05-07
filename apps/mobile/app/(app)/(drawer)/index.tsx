import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter, useGlobalSearchParams } from "expo-router";
import { useOrganizations } from "@/hooks/useOrganizations";
import { OrganizationRow } from "@/components/org-switcher/OrganizationRow";
import { OrgSwitcherActions } from "@/components/org-switcher/OrgSwitcherActions";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SHADOWS, RADIUS, SPACING } from "@/lib/design-tokens";
import { spacing, fontSize } from "@/lib/theme";
import type { Organization } from "@teammeet/types";
import { getWebRoute } from "@/lib/web-api";

const WORDMARK = require("../../../assets/brand-logo.png");

// Wordmark natural ratio is 220:146 ≈ 1.507 wide:tall
const WORDMARK_WIDTH = 130;
const WORDMARK_HEIGHT = Math.round(WORDMARK_WIDTH / 1.507); // ≈ 86

export default function OrganizationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useGlobalSearchParams<{
    orgSlug?: string;
    currentSlug?: string;
    pendingSales?: string;
    pendingFinalize?: string;
  }>();
  const currentSlug = params.currentSlug ?? params.orgSlug;
  const pendingSalesSlug =
    typeof params.pendingSales === "string" ? params.pendingSales : null;
  const pendingFinalizeSlug =
    typeof params.pendingFinalize === "string" ? params.pendingFinalize : null;
  const { organizations, pendingOrganizations, loading, error, refetch } = useOrganizations();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(refetch()).finally(() => setRefreshing(false));
  }, [refetch]);

  const handleOrgPress = useCallback(
    (org: Organization) => {
      router.replace(`/(app)/${org.slug}/(tabs)` as const);
    },
    [router]
  );

  const openWebOnboardingRoute = useCallback((path: string) => {
    void WebBrowser.openBrowserAsync(getWebRoute(path), {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: NEUTRAL.foreground,
      dismissButtonStyle: "close",
    }).catch(() => {
      // No-op: keep the current screen stable if the browser can't open.
    });
  }, []);

  const GradientHeader = (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerContent}>
          <Image
            source={WORDMARK}
            style={styles.wordmark}
            contentFit="contain"
            transition={0}
            cachePolicy="memory"
          />
          <Text style={styles.headerTitle}>My Organizations</Text>
          <Text style={styles.headerSubtitle}>Select an organization to continue</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {GradientHeader}
        <View style={[styles.contentSheet, styles.centered]}>
          <ActivityIndicator size="large" color={NEUTRAL.foreground} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        {GradientHeader}
        <View style={[styles.contentSheet, styles.centered]}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={refetch} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const hasOrgs = organizations.length > 0;
  const hasPendingOrgs = pendingOrganizations.length > 0;

  return (
    <View style={styles.container}>
      {GradientHeader}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + SPACING.xxl },
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {pendingSalesSlug != null && (
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>Custom plan request received</Text>
              <Text style={styles.bannerText}>
                Thanks! We'll reach out to finalize pricing for{" "}
                <Text style={styles.bannerSlug}>{pendingSalesSlug}</Text>. Your
                organization will be visible once it's set up.
              </Text>
            </View>
          )}
          {pendingFinalizeSlug != null && pendingSalesSlug == null && (
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>Finalizing your organization</Text>
              <Text style={styles.bannerText}>
                Payment confirmed. Your new org should appear here in a few
                seconds. Pull to refresh if it doesn't show up.
              </Text>
            </View>
          )}
          {hasOrgs ? (
            <View style={styles.cardGroup}>
              {organizations.map((org, index) => {
                const isCurrent = currentSlug ? org.slug === currentSlug : undefined;
                const isLast = index === organizations.length - 1;
                return (
                  <OrganizationRow
                    key={org.id}
                    org={org}
                    isCurrent={isCurrent}
                    onPress={() => handleOrgPress(org)}
                    isFirst={index === 0}
                    isLast={isLast}
                    showDivider={!isLast}
                  />
                );
              })}
            </View>
          ) : hasPendingOrgs ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Access Pending</Text>
              <Text style={styles.emptyText}>
                Your request is in with a team admin. Your organization will appear here as soon as
                access is approved.
              </Text>
              <View style={styles.pendingGroup}>
                {pendingOrganizations.map((org) => (
                  <View key={org.id} style={styles.pendingRow}>
                    <Text style={styles.pendingOrgName} numberOfLines={1}>
                      {org.name}
                    </Text>
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>Pending</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={styles.emptyActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyActionButton,
                    styles.emptyActionButtonPrimary,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => openWebOnboardingRoute("/app/join")}
                  accessibilityLabel="Join Another Team"
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionButtonPrimaryText}>Join Another Team</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyActionButton,
                    styles.emptyActionButtonSecondary,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => router.push("/(app)/(drawer)/create-org" as never)}
                  accessibilityLabel="Create a Team"
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionButtonSecondaryText}>Create a Team</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Welcome to TeamNetwork</Text>
              <Text style={styles.emptyText}>
                Join an existing team or create a new one
              </Text>
              <Text style={styles.emptyHint}>
                Already requested access? Your team admin may still need to approve you before it
                appears here.
              </Text>
              <View style={styles.emptyActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyActionButton,
                    styles.emptyActionButtonPrimary,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => openWebOnboardingRoute("/app/join")}
                  accessibilityLabel="Join a Team"
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionButtonPrimaryText}>Join a Team</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyActionButton,
                    styles.emptyActionButtonSecondary,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => router.push("/(app)/(drawer)/create-org" as never)}
                  accessibilityLabel="Create a Team"
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionButtonSecondaryText}>Create a Team</Text>
                </Pressable>
              </View>
            </View>
          )}

          <OrgSwitcherActions />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_CHROME.gradientEnd,
  },
  headerContent: {
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  wordmark: {
    width: WORDMARK_WIDTH,
    height: WORDMARK_HEIGHT,
    marginBottom: SPACING.sm,
  },
  headerTitle: {
    color: APP_CHROME.headerTitle,
    fontSize: fontSize.lg,
    fontWeight: "700",
    marginBottom: 4,
  },
  headerSubtitle: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
    textAlign: "center",
  },
  contentSheet: {
    flex: 1,
    backgroundColor: "#F2F2F7",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
  },
  scrollContent: {
    paddingTop: SPACING.lg,
  },
  banner: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: "rgba(2, 132, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(2, 132, 199, 0.24)",
    gap: 4,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: NEUTRAL.foreground,
  },
  bannerText: {
    fontSize: 13,
    color: NEUTRAL.secondary,
    lineHeight: 18,
  },
  bannerSlug: {
    fontWeight: "600",
    color: NEUTRAL.foreground,
  },
  // Grouped card container — iOS Settings style
  cardGroup: {
    marginHorizontal: SPACING.md,
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.xl,
    overflow: "hidden",
    ...SHADOWS.sm,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  errorText: {
    fontSize: 14,
    color: NEUTRAL.muted,
    textAlign: "center",
    marginBottom: SPACING.md,
  },
  retryButton: {
    backgroundColor: NEUTRAL.foreground,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: RADIUS.lg,
  },
  retryButtonText: {
    color: NEUTRAL.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: 15,
    color: NEUTRAL.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyHint: {
    fontSize: 14,
    color: NEUTRAL.muted,
    textAlign: "center",
    lineHeight: 20,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  emptyActions: {
    width: "100%",
    gap: 12,
  },
  pendingGroup: {
    width: "100%",
    marginBottom: SPACING.xl,
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.xl,
    overflow: "hidden",
    ...SHADOWS.sm,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: NEUTRAL.border,
  },
  pendingOrgName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: NEUTRAL.foreground,
    marginRight: SPACING.md,
  },
  pendingBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#b45309",
  },
  emptyActionButton: {
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    alignItems: "center",
  },
  emptyActionButtonPrimary: {
    backgroundColor: NEUTRAL.foreground,
  },
  emptyActionButtonPrimaryText: {
    color: NEUTRAL.surface,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyActionButtonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: NEUTRAL.foreground,
  },
  emptyActionButtonSecondaryText: {
    color: NEUTRAL.foreground,
    fontSize: 15,
    fontWeight: "600",
  },
});
