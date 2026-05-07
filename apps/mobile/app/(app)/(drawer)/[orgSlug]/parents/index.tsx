import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Share,
  Text,
  View,
  FlatList,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Plus,
  ShieldX,
  Users,
} from "lucide-react-native";
import {
  DirectoryCard,
  DirectoryEmptyState,
  DirectoryFilterChipsRow,
  DirectorySearchBar,
  DirectorySkeleton,
} from "@/components/directory";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { ErrorState } from "@/components/ui";
import { showToast } from "@/components/ui/Toast";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useParentInvites } from "@/hooks/useParentInvites";
import { useParents } from "@/hooks/useParents";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  buildParentInviteLink,
  getParentDisplayName,
  getParentInitials,
  isParentInvitePending,
} from "@/lib/parents";
import { getWebPath } from "@/lib/web-api";

export default function ParentsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl, hasParentsAccess, isLoading: orgLoading } = useOrg();
  const { role, permissions, isLoading: roleLoading } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();
  const accessResolved = !orgLoading && !roleLoading;
  const canReadParents =
    accessResolved &&
    hasParentsAccess &&
    (role === "admin" || role === "active_member" || role === "parent");
  const canManageParents = accessResolved && permissions.canUseAdminActions && hasParentsAccess;

  const {
    parents,
    loading,
    error,
    refetch,
    refetchIfStale,
  } = useParents(orgId, canReadParents);
  const {
    invites,
    loading: invitesLoading,
    createInvite,
    revokeInvite,
    deleteInvite,
  } = useParentInvites(orgId, canManageParents);

  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRelationship, setSelectedRelationship] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);

  const directoryColors = useMemo(() => ({
    background: neutral.surface,
    foreground: neutral.foreground,
    card: neutral.surface,
    border: neutral.border,
    muted: neutral.muted,
    mutedForeground: neutral.secondary,
    primary: semantic.success,
    primaryLight: semantic.successLight,
    primaryDark: semantic.successDark,
    primaryForeground: "#ffffff",
    secondary: semantic.info,
    secondaryLight: semantic.infoLight,
    secondaryDark: semantic.infoDark,
    secondaryForeground: "#ffffff",
    mutedSurface: neutral.background,
    success: semantic.success,
    warning: semantic.warning,
    error: semantic.error,
  }), [neutral, semantic]);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
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
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
      fontVariant: ["tabular-nums"] as const,
    },
    headerActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    createButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    listHeader: {
      backgroundColor: n.surface,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      gap: SPACING.md,
    },
    listContent: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.xl,
      flexGrow: 1,
    },
    accessContainer: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      gap: SPACING.md,
    },
    accessTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      textAlign: "center" as const,
    },
    accessText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      textAlign: "center" as const,
    },
    accessButton: {
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
    },
    accessButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    inviteCard: {
      marginHorizontal: SPACING.md,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.background,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    inviteHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
    },
    inviteTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    inviteCode: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontFamily: "monospace",
    },
    inviteMeta: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    inviteActions: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    inviteActionButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs + 2,
    },
    inviteActionText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
  }));

  useEffect(() => {
    if (accessResolved && !canReadParents && orgSlug) {
      router.replace(`/(app)/${orgSlug}`);
    }
  }, [accessResolved, canReadParents, orgSlug, router]);

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  useAutoRefetchOnReconnect(refetch);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

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

  const relationships = useMemo(() => {
    return Array.from(
      new Set(parents.map((parent) => parent.relationship).filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b));
  }, [parents]);

  const filteredParents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return parents.filter((parent) => {
      if (selectedRelationship && parent.relationship !== selectedRelationship) {
        return false;
      }

      if (!query) return true;

      const searchable = [
        parent.first_name,
        parent.last_name,
        parent.email,
        parent.student_name,
        parent.relationship,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [parents, searchQuery, selectedRelationship]);

  const pendingInvite = useMemo(
    () => invites.find((invite) => isParentInvitePending(invite)) ?? null,
    [invites]
  );

  const handleCopyInvite = useCallback(async () => {
    if (!pendingInvite || !orgId) return;
    await Clipboard.setStringAsync(buildParentInviteLink(orgId, pendingInvite.code));
    showToast("Invite link copied", "success");
  }, [orgId, pendingInvite]);

  const handleShareInvite = useCallback(async () => {
    if (!pendingInvite || !orgId) return;
    await Share.share({
      message: buildParentInviteLink(orgId, pendingInvite.code),
    });
  }, [orgId, pendingInvite]);

  const handleCreateInvite = useCallback(async () => {
    const result = await createInvite();
    if (!result.success) {
      showToast(result.error || "Unable to create invite", "error");
      return;
    }
    showToast("Parent invite ready to share", "success");
  }, [createInvite]);

  const handleRevokeInvite = useCallback(async () => {
    if (!pendingInvite) return;
    const result = await revokeInvite(pendingInvite.id);
    if (!result.success) {
      showToast(result.error || "Unable to revoke invite", "error");
      return;
    }
    showToast("Invite revoked", "success");
  }, [pendingInvite, revokeInvite]);

  const handleDeleteInvite = useCallback(async () => {
    if (!pendingInvite) return;
    const result = await deleteInvite(pendingInvite.id);
    if (!result.success) {
      showToast(result.error || "Unable to delete invite", "error");
      return;
    }
    showToast("Invite deleted", "success");
  }, [deleteInvite, pendingInvite]);

  const menuItems = useMemo<OverflowMenuItem[]>(() => {
    if (!canManageParents) return [];

    const items: OverflowMenuItem[] = [];

    if (!pendingInvite) {
      items.push({
        id: "create-parent-invite",
        label: "Create Parent Invite",
        icon: <LinkIcon size={18} color={semantic.success} />,
        onPress: handleCreateInvite,
      });
    }

    if (pendingInvite) {
      items.push(
        {
          id: "share-parent-invite",
          label: "Share Invite Link",
          icon: <LinkIcon size={18} color={neutral.foreground} />,
          onPress: handleShareInvite,
        },
        {
          id: "copy-parent-invite",
          label: "Copy Invite Link",
          icon: <Copy size={18} color={neutral.foreground} />,
          onPress: handleCopyInvite,
        },
        {
          id: "revoke-parent-invite",
          label: "Revoke Invite",
          icon: <ShieldX size={18} color={semantic.error} />,
          onPress: handleRevokeInvite,
          destructive: true,
        },
        {
          id: "delete-parent-invite",
          label: "Delete Invite",
          icon: <ShieldX size={18} color={semantic.error} />,
          onPress: handleDeleteInvite,
          destructive: true,
        }
      );
    }

    items.push({
      id: "open-in-web",
      label: "Open in Web",
      icon: <ExternalLink size={18} color={neutral.foreground} />,
      onPress: () => {
        const webUrl = getWebPath(orgSlug, "parents");
        Linking.openURL(webUrl);
      },
    });

    return items;
  }, [
    canManageParents,
    handleCopyInvite,
    handleCreateInvite,
    handleDeleteInvite,
    handleRevokeInvite,
    handleShareInvite,
    neutral.foreground,
    orgSlug,
    pendingInvite,
    semantic.error,
    semantic.success,
  ]);

  const listHeader = (
    <View style={styles.listHeader}>
      <DirectorySearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search parents"
        colors={directoryColors}
      />

      <DirectoryFilterChipsRow
        groups={[
          {
            label: "Relationship",
            options: relationships,
            selected: selectedRelationship,
            onSelect: (value) => setSelectedRelationship((value as string | null) ?? null),
          },
        ]}
        colors={directoryColors}
        hasActiveFilters={searchQuery.length > 0 || selectedRelationship !== null}
        onClearAll={() => {
          setSearchQuery("");
          setSelectedRelationship(null);
        }}
      />

      {canManageParents && pendingInvite ? (
        <View style={styles.inviteCard}>
          <View style={styles.inviteHeader}>
            <View>
              <Text style={styles.inviteTitle}>Pending Parent Invite</Text>
              <Text style={styles.inviteCode}>Code: {pendingInvite.code}</Text>
            </View>
            {invitesLoading ? <ActivityIndicator size="small" color={semantic.success} /> : null}
          </View>
          <Text style={styles.inviteMeta}>
            Share this with families to let them finish setup on the web.
          </Text>
          <View style={styles.inviteActions}>
            <Pressable
              onPress={handleShareInvite}
              style={({ pressed }) => [styles.inviteActionButton, pressed && { opacity: 0.7 }]}
            >
              <LinkIcon size={16} color={semantic.success} />
              <Text style={styles.inviteActionText}>Share</Text>
            </Pressable>
            <Pressable
              onPress={handleCopyInvite}
              style={({ pressed }) => [styles.inviteActionButton, pressed && { opacity: 0.7 }]}
            >
              <Copy size={16} color={semantic.success} />
              <Text style={styles.inviteActionText}>Copy</Text>
            </Pressable>
            <Pressable
              onPress={handleRevokeInvite}
              style={({ pressed }) => [styles.inviteActionButton, pressed && { opacity: 0.7 }]}
            >
              <ShieldX size={16} color={semantic.error} />
              <Text style={styles.inviteActionText}>Revoke</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  if (!accessResolved) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={semantic.success} />
        </View>
      </View>
    );
  }

  if (!canReadParents) {
    return (
      <View style={styles.container}>
        <View style={styles.accessContainer}>
          <Users size={36} color={semantic.warning} />
          <Text style={styles.accessTitle}>Parents are not available here</Text>
          <Text style={styles.accessText}>
            This organization does not have the parents directory enabled for your account.
          </Text>
          <Pressable
            onPress={() => router.replace(`/(app)/${orgSlug}`)}
            style={({ pressed }) => [styles.accessButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.accessButtonText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="cover" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Parents</Text>
                <Text style={styles.headerMeta}>Loading directory</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <DirectorySkeleton colors={directoryColors} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <ErrorState
        onRetry={refetch}
        title="Unable to load parents"
        subtitle={error}
        isOffline={isOffline}
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
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="cover" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>

            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Parents</Text>
              <Text style={styles.headerMeta}>
                {filteredParents.length} {filteredParents.length === 1 ? "record" : "records"}
              </Text>
            </View>

            <View style={styles.headerActions}>
              {canManageParents ? (
                <Pressable
                  onPress={() => router.push(`/(app)/${orgSlug}/parents/new`)}
                  style={({ pressed }) => [styles.createButton, pressed && { opacity: 0.85 }]}
                >
                  <Plus size={18} color={APP_CHROME.headerTitle} />
                </Pressable>
              ) : null}
              <OverflowMenu items={menuItems} accessibilityLabel="Parent directory options" />
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <FlatList
          data={filteredParents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DirectoryCard
              avatarUrl={item.photo_url}
              initials={getParentInitials(item)}
              name={getParentDisplayName(item)}
              subtitle={item.student_name ? `Parent of ${item.student_name}` : item.email}
              chips={item.relationship ? [{ key: item.relationship, label: item.relationship }] : []}
              colors={directoryColors}
              onPress={() => router.push(`/(app)/${orgSlug}/parents/${item.id}`)}
            />
          )}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <DirectoryEmptyState
              icon={<Users size={40} color={directoryColors.muted} />}
              title={searchQuery || selectedRelationship ? "No matching parents" : "No parents yet"}
              subtitle={
                searchQuery || selectedRelationship
                  ? "Try a different search or clear your filters."
                  : canManageParents
                    ? "Add a parent record or create a parent invite to get started."
                    : "No parent records have been added yet."
              }
              colors={directoryColors}
              showClearButton={Boolean(searchQuery || selectedRelationship)}
              onClear={() => {
                setSearchQuery("");
                setSelectedRelationship(null);
              }}
            />
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={semantic.success}
            />
          }
        />
      </View>
    </View>
  );
}
