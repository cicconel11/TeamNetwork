import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { ExternalLink, FileText, ClipboardList } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useForms } from "@/hooks/useForms";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import type { Form, FormDocument } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL } from "@/lib/design-tokens";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

// Neutral color palette
const FORMS_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  submittedBadge: "#d1fae5",
  submittedText: "#065f46",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  pdfIcon: "#ef4444",
};

type ListItem =
  | { type: "section-header"; title: string }
  | { type: "form"; data: Form }
  | { type: "document"; data: FormDocument }
  | { type: "empty" };

export default function FormsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const {
    forms,
    formDocuments,
    submittedFormIds,
    submittedDocIds,
    loading,
    error,
    refetch,
    refetchIfStale,
  } = useForms(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

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
        icon: <ExternalLink size={20} color={FORMS_COLORS.primaryText} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/forms`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug]);

  // Refetch on screen focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

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
          <ClipboardList size={48} color={FORMS_COLORS.mutedText} />
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
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
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
        </TouchableOpacity>
      );
    }

    if (item.type === "document") {
      const doc = item.data;
      const isSubmitted = submittedDocIds.has(doc.id);

      return (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => router.push(`/(app)/${orgSlug}/forms/documents/${doc.id}`)}
        >
          <View style={styles.cardHeader}>
            <View style={styles.docTitleRow}>
              <FileText size={20} color={FORMS_COLORS.pdfIcon} />
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
        </TouchableOpacity>
      );
    }

    return null;
  };

  if (loading && forms.length === 0 && formDocuments.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={FORMS_COLORS.primaryCTA} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
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
            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
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
              tintColor={FORMS_COLORS.primaryCTA}
            />
          }
        />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
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
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    listContent: {
      padding: spacing.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Section headers
    sectionHeader: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: FORMS_COLORS.secondaryText,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    // Cards
    card: {
      backgroundColor: FORMS_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: FORMS_COLORS.border,
      padding: spacing.md,
      marginBottom: 12,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    docTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flex: 1,
    },
    cardTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: FORMS_COLORS.primaryText,
      flex: 1,
    },
    submittedBadge: {
      backgroundColor: FORMS_COLORS.submittedBadge,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: borderRadius.lg,
    },
    submittedText: {
      fontSize: 11,
      fontWeight: fontWeight.medium,
      color: FORMS_COLORS.submittedText,
    },
    cardDescription: {
      fontSize: fontSize.sm,
      color: FORMS_COLORS.secondaryText,
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.xs,
    },
    fieldCount: {
      fontSize: fontSize.xs,
      color: FORMS_COLORS.mutedText,
    },
    actionButton: {
      backgroundColor: FORMS_COLORS.primaryCTA,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: borderRadius.md,
    },
    actionButtonSecondary: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: FORMS_COLORS.border,
    },
    actionButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: FORMS_COLORS.primaryCTAText,
    },
    actionButtonTextSecondary: {
      color: FORMS_COLORS.secondaryText,
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: FORMS_COLORS.primaryText,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: FORMS_COLORS.mutedText,
      textAlign: "center",
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: FORMS_COLORS.background,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: FORMS_COLORS.error,
    },
  });
