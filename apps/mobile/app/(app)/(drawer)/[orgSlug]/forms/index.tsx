import { useCallback, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { ExternalLink, FileText, ClipboardList, ChevronLeft } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useForms } from "@/hooks/useForms";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { ErrorState } from "@/components/ui";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import type { Form, FormDocument } from "@teammeet/types";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type ListItem =
  | { type: "section-header"; title: string }
  | { type: "form"; data: Form }
  | { type: "document"; data: FormDocument }
  | { type: "empty" };

export default function FormsScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();
  const {
    forms,
    formDocuments,
    submittedFormIds,
    submittedDocIds,
    loading,
    error,
    refetch,
    refetchIfStale,
  } = useForms(orgId);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    } as const,
    headerGradient: {
      paddingBottom: SPACING.xs,
    } as const,
    headerSafeArea: {} as const,
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      width: 32,
      height: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    } as const,
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    } as const,
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
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    } as const,
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    } as const,
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    } as const,
    sectionHeader: {
      ...TYPOGRAPHY.overline,
      color: n.secondary,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: 12,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
    },
    cardHeader: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    docTitleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      flex: 1,
    },
    cardTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
    },
    submittedBadge: {
      backgroundColor: s.successLight,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: RADIUS.lg,
    } as const,
    submittedText: {
      ...TYPOGRAPHY.labelSmall,
      color: s.successDark,
    },
    cardDescription: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      lineHeight: 20,
      marginBottom: SPACING.sm,
    },
    cardFooter: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginTop: SPACING.xs,
    },
    fieldCount: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    actionButton: {
      backgroundColor: s.success,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: RADIUS.md,
    } as const,
    actionButtonSecondary: {
      backgroundColor: "transparent" as const,
      borderWidth: 1,
      borderColor: n.border,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    actionButtonTextSecondary: {
      color: n.secondary,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      paddingVertical: 64,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      textAlign: "center" as const,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: 20,
      backgroundColor: n.background,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
  }));

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(app)/${orgSlug}/(tabs)`);
    }
  }, [router, orgSlug]);

  // Safe drawer toggle
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Admin overflow menu items
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={neutral.foreground} />,
        onPress: () => {
          const webUrl = getWebPath(orgSlug, "forms");
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, neutral.foreground]);

  // Refetch on screen focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  useAutoRefetchOnReconnect(refetch);

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await refetch();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch]);

  // Build list data with section headers
  const listData: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];

    if (forms.length === 0 && formDocuments.length === 0) {
      items.push({ type: "empty" });
      return items;
    }

    if (forms.length > 0) {
      items.push({ type: "section-header", title: "Questionnaire Forms" });
      forms.forEach((form) => {
        items.push({ type: "form", data: form });
      });
    }

    if (formDocuments.length > 0) {
      items.push({ type: "section-header", title: "Document Forms" });
      formDocuments.forEach((doc) => {
        items.push({ type: "document", data: doc });
      });
    }

    return items;
  }, [forms, formDocuments]);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "section-header") {
      return (
        <Text style={styles.sectionHeader}>{item.title}</Text>
      );
    }

    if (item.type === "empty") {
      return (
        <View style={styles.emptyContainer}>
          <ClipboardList size={48} color={neutral.muted} />
          <Text style={styles.emptyTitle}>No Forms Available</Text>
          <Text style={styles.emptyText}>
            Forms will appear here when available.
          </Text>
        </View>
      );
    }

    if (item.type === "form") {
      const form = item.data;
      const isSubmitted = submittedFormIds.has(form.id);
      const fieldCount = (form.fields as unknown[])?.length || 0;

      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          onPress={() => router.push(`/(app)/${orgSlug}/forms/${form.id}`)}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle} numberOfLines={1}>{form.title}</Text>
            {isSubmitted && (
              <View style={styles.submittedBadge}>
                <Text style={styles.submittedText}>Submitted</Text>
              </View>
            )}
          </View>
          {form.description && (
            <Text style={styles.cardDescription} numberOfLines={2}>
              {form.description}
            </Text>
          )}
          <View style={styles.cardFooter}>
            <Text style={styles.fieldCount}>{fieldCount} fields</Text>
            <View style={[styles.actionButton, isSubmitted && styles.actionButtonSecondary]}>
              <Text style={[styles.actionButtonText, isSubmitted && styles.actionButtonTextSecondary]}>
                {isSubmitted ? "View / Edit" : "Fill Out"}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    }

    if (item.type === "document") {
      const doc = item.data;
      const isSubmitted = submittedDocIds.has(doc.id);

      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          onPress={() => router.push(`/(app)/${orgSlug}/forms/documents/${doc.id}`)}
        >
          <View style={styles.cardHeader}>
            <View style={styles.docTitleRow}>
              <FileText size={20} color={semantic.error} />
              <Text style={styles.cardTitle} numberOfLines={1}>{doc.title}</Text>
            </View>
            {isSubmitted && (
              <View style={styles.submittedBadge}>
                <Text style={styles.submittedText}>Submitted</Text>
              </View>
            )}
          </View>
          {doc.description && (
            <Text style={styles.cardDescription} numberOfLines={2}>
              {doc.description}
            </Text>
          )}
          <View style={styles.cardFooter}>
            <View style={{ flex: 1 }} />
            <View style={[styles.actionButton, isSubmitted && styles.actionButtonSecondary]}>
              <Text style={[styles.actionButtonText, isSubmitted && styles.actionButtonTextSecondary]}>
                {isSubmitted ? "View / Resubmit" : "Download & Submit"}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    }

    return null;
  };

  if (loading && forms.length === 0 && formDocuments.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={semantic.success} />
      </View>
    );
  }

  if (error && forms.length === 0 && formDocuments.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Forms</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load forms"
          isOffline={isOffline}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Back button */}
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>

            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>

            {/* Title */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Forms</Text>
            </View>

            {/* Overflow Menu (admin only) */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Forms options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={listData}
          keyExtractor={(item, index) => {
            if (item.type === "section-header") return `header-${item.title}`;
            if (item.type === "form") return `form-${item.data.id}`;
            if (item.type === "document") return `doc-${item.data.id}`;
            return `empty-${index}`;
          }}
          contentContainerStyle={styles.listContent}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={semantic.success}
            />
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      </View>
    </View>
  );
}
