import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import {
  ChevronLeft,
  ExternalLink,
  Linkedin,
  Mail,
  Pencil,
  Phone,
  Trash2,
} from "lucide-react-native";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { ErrorState } from "@/components/ui";
import { showToast } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";
import { fetchParentDetail, useParents } from "@/hooks/useParents";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getParentDisplayName, getParentInitials, type ParentRecord } from "@/lib/parents";
import { openEmailAddress, openHttpsUrl } from "@/lib/url-safety";
import { getWebPath } from "@/lib/web-api";

export default function ParentDetailScreen() {
  const { parentId } = useLocalSearchParams<{ parentId: string }>();
  const resolvedParentId = Array.isArray(parentId) ? parentId[0] : parentId;
  const router = useRouter();
  const { user } = useAuth();
  const { orgId, orgSlug } = useOrg();
  const { role } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { deleteParent } = useParents(orgId, role === "admin" || role === "parent");
  const [parent, setParent] = useState<ParentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canEdit =
    role === "admin" || (role === "parent" && parent?.user_id != null && parent.user_id === user?.id);
  const canDelete = role === "admin";

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    profileHeader: {
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
    },
    avatarPlaceholder: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: s.successLight,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarText: {
      ...TYPOGRAPHY.headlineMedium,
      color: s.successDark,
    },
    name: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      textAlign: "center" as const,
    },
    subtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      textAlign: "center" as const,
    },
    chip: {
      borderRadius: RADIUS.full,
      backgroundColor: n.background,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: n.border,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    actionsRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    actionButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.surface,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    section: {
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
      overflow: "hidden" as const,
    },
    detailRow: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      gap: SPACING.xs,
    },
    detailLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
    },
    detailValue: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    notesText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      lineHeight: 22,
    },
  }));

  const loadParent = useCallback(async () => {
    if (!orgId || !resolvedParentId) return;

    try {
      setLoading(true);
      const data = await fetchParentDetail(orgId, resolvedParentId);
      setParent(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setParent(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, resolvedParentId]);

  useEffect(() => {
    loadParent();
  }, [loadParent]);

  const handleDelete = useCallback(() => {
    if (!resolvedParentId || !canDelete) return;

    Alert.alert(
      "Delete parent?",
      "This removes the parent record from the directory.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const result = await deleteParent(resolvedParentId);
            if (!result.success) {
              showToast(result.error || "Unable to delete parent", "error");
              return;
            }
            showToast("Parent deleted", "success");
            router.replace(`/(app)/${orgSlug}/parents`);
          },
        },
      ]
    );
  }, [canDelete, deleteParent, orgSlug, resolvedParentId, router]);

  const menuItems = useMemo<OverflowMenuItem[]>(() => {
    if (!parent) return [];

    const items: OverflowMenuItem[] = [];

    if (canEdit) {
      items.push({
        id: "edit",
        label: "Edit Parent",
        icon: <Pencil size={18} color={neutral.foreground} />,
        onPress: () => router.push(`/(app)/${orgSlug}/parents/${parent.id}/edit`),
      });
    }

    items.push({
      id: "open-web",
      label: "Open in Web",
      icon: <ExternalLink size={18} color={neutral.foreground} />,
      onPress: () => {
        openHttpsUrl(getWebPath(orgSlug, `parents/${parent.id}`));
      },
    });

    if (canDelete) {
      items.push({
        id: "delete",
        label: "Delete Parent",
        icon: <Trash2 size={18} color={semantic.error} />,
        onPress: handleDelete,
        destructive: true,
      });
    }

    return items;
  }, [canDelete, canEdit, handleDelete, neutral.foreground, orgSlug, parent, router, semantic.error]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={semantic.success} />
        </View>
      </View>
    );
  }

  if (error || !parent) {
    return (
      <ErrorState
        onRetry={loadParent}
        title="Unable to load parent"
        subtitle={error || "Parent not found"}
      />
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Parent Profile</Text>
            </View>
            <OverflowMenu items={menuItems} accessibilityLabel="Parent profile options" />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileHeader}>
          {parent.photo_url ? (
            <Image source={parent.photo_url} style={styles.avatar} contentFit="cover" transition={200} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{getParentInitials(parent)}</Text>
            </View>
          )}
          <Text style={styles.name}>{getParentDisplayName(parent)}</Text>
          <Text style={styles.subtitle}>
            {parent.student_name ? `Parent of ${parent.student_name}` : "Parent directory record"}
          </Text>
          {parent.relationship ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{parent.relationship}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionsRow}>
          {parent.email ? (
            <Pressable
              onPress={() => openEmailAddress(parent.email!)}
              style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
            >
              <Mail size={18} color={semantic.success} />
              <Text style={styles.actionButtonText}>Email</Text>
            </Pressable>
          ) : null}
          {parent.phone_number ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${parent.phone_number!}`)}
              style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
            >
              <Phone size={18} color={semantic.success} />
              <Text style={styles.actionButtonText}>Call</Text>
            </Pressable>
          ) : null}
          {parent.linkedin_url ? (
            <Pressable
              onPress={() => openHttpsUrl(parent.linkedin_url!)}
              style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
            >
              <Linkedin size={18} color={semantic.success} />
              <Text style={styles.actionButtonText}>LinkedIn</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Student</Text>
            <Text style={styles.detailValue}>{parent.student_name || "Not set"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Relationship</Text>
            <Text style={styles.detailValue}>{parent.relationship || "Not set"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email</Text>
            <Text style={styles.detailValue}>{parent.email || "Not set"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Phone</Text>
            <Text style={styles.detailValue}>{parent.phone_number || "Not set"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>LinkedIn</Text>
            <Text style={styles.detailValue}>{parent.linkedin_url || "Not set"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Linked Account</Text>
            <Text style={styles.detailValue}>{parent.user_id ? "Connected" : "Not connected"}</Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Notes</Text>
            <Text style={styles.notesText}>{parent.notes || "No notes"}</Text>
          </View>
        </View>

        {canEdit ? (
          <Pressable
            onPress={() => router.push(`/(app)/${orgSlug}/parents/${parent.id}/edit`)}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: SPACING.xs,
                borderRadius: RADIUS.md,
                backgroundColor: semantic.success,
                paddingVertical: SPACING.sm + 2,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Pencil size={18} color="#ffffff" />
            <Text style={{ ...TYPOGRAPHY.labelLarge, color: "#ffffff" }}>Edit Parent</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
