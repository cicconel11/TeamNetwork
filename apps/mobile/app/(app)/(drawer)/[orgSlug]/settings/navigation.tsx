import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useNavConfig, type NavConfig, type NavConfigEntry } from "@/hooks/useNavConfig";
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { OrgRole } from "@teammeet/core";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import {
  Home,
  Users,
  MessageCircle,
  GraduationCap,
  Handshake,
  Dumbbell,
  Award,
  Calendar,
  Megaphone,
  Heart,
  DollarSign,
  Receipt,
  Trophy,
  BookOpen,
  ClipboardList,
  Settings,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Check,
} from "lucide-react-native";

// Navigation items that can be configured (mirrors web's ORG_NAV_ITEMS)
const NAV_ITEMS = [
  { href: "", label: "Dashboard", icon: Home, configurable: true },
  { href: "/members", label: "Members", icon: Users, configurable: true },
  { href: "/chat", label: "Chat", icon: MessageCircle, configurable: true },
  { href: "/alumni", label: "Alumni", icon: GraduationCap, configurable: true },
  { href: "/mentorship", label: "Mentorship", icon: Handshake, configurable: true },
  { href: "/workouts", label: "Workouts", icon: Dumbbell, configurable: true },
  { href: "/competition", label: "Competition", icon: Award, configurable: true },
  { href: "/events", label: "Events", icon: Calendar, configurable: true },
  { href: "/announcements", label: "Announcements", icon: Megaphone, configurable: true },
  { href: "/philanthropy", label: "Philanthropy", icon: Heart, configurable: true },
  { href: "/donations", label: "Donations", icon: DollarSign, configurable: true },
  { href: "/expenses", label: "Expenses", icon: Receipt, configurable: true },
  { href: "/records", label: "Records", icon: Trophy, configurable: true },
  { href: "/schedules", label: "Schedules", icon: BookOpen, configurable: true },
  { href: "/forms", label: "Forms", icon: ClipboardList, configurable: true },
  { href: "/settings", label: "Customization", icon: Settings, configurable: false },
];

const CONFIGURABLE_ITEMS = NAV_ITEMS.filter((item) => item.configurable !== false);
const ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni"];

// Get config key for nav item (Dashboard has empty href)
const getConfigKey = (href: string) => (href === "" ? "dashboard" : href);

export default function NavigationSettingsScreen() {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(), []);

  const { navConfig, loading, saving, error, saveNavConfig, refetch } = useNavConfig(orgSlug);

  // Local state
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [localConfig, setLocalConfig] = useState<NavConfig>({});
  const [orderedItems, setOrderedItems] = useState(CONFIGURABLE_ITEMS);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch user role
  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgId || !user) {
        setRoleLoading(false);
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .single();

        if (roleData && isMounted) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);
        }
      } catch (e) {
        console.error("Failed to fetch role:", e);
        captureException(e as Error, { screen: "NavigationSettings", context: "fetchRole", orgId });
      } finally {
        if (isMounted) {
          setRoleLoading(false);
        }
      }
    }

    fetchRole();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  // Sort items by order from config
  const sortItemsByOrder = useCallback(
    (items: typeof CONFIGURABLE_ITEMS, config: NavConfig) => {
      return [...items].sort((a, b) => {
        const keyA = getConfigKey(a.href);
        const keyB = getConfigKey(b.href);
        const orderA = config[keyA]?.order;
        const orderB = config[keyB]?.order;
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
        if (orderA !== undefined) return -1;
        if (orderB !== undefined) return 1;
        return NAV_ITEMS.findIndex((i) => i.href === a.href) - NAV_ITEMS.findIndex((i) => i.href === b.href);
      });
    },
    []
  );

  // Sync local state with fetched config
  useEffect(() => {
    if (!loading) {
      setLocalConfig(navConfig);
      setOrderedItems(sortItemsByOrder(CONFIGURABLE_ITEMS, navConfig));
      setHasChanges(false);
    }
  }, [navConfig, loading, sortItemsByOrder]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const updateEntry = (href: string, updater: (entry?: NavConfigEntry) => NavConfigEntry | undefined) => {
    const key = getConfigKey(href);
    setLocalConfig((prev) => {
      const updated = { ...prev };
      const nextValue = updater(prev[key]);
      if (nextValue && Object.keys(nextValue).length > 0) {
        updated[key] = nextValue;
      } else {
        delete updated[key];
      }
      return updated;
    });
    setHasChanges(true);
  };

  const handleLabelChange = (href: string, label: string) => {
    updateEntry(href, (current = {}) => {
      const trimmed = label.trim();
      const next: NavConfigEntry = { ...current };
      if (trimmed) next.label = trimmed;
      else delete next.label;
      if (!next.hidden && !next.hiddenForRoles?.length && !next.order && !next.editRoles?.length) {
        return Object.keys(next).length ? next : undefined;
      }
      return next;
    });
  };

  const toggleRoleHidden = (href: string, role: OrgRole) => {
    updateEntry(href, (current = {}) => {
      const roles = Array.isArray(current.hiddenForRoles) ? [...current.hiddenForRoles] : [];
      const exists = roles.includes(role);
      const nextRoles = exists ? roles.filter((r) => r !== role) : [...roles, role];
      const next: NavConfigEntry = { ...current };
      if (nextRoles.length) next.hiddenForRoles = nextRoles;
      else delete next.hiddenForRoles;
      if (!next.label && !next.hidden && !next.hiddenForRoles?.length && !next.order && !next.editRoles?.length)
        return undefined;
      return next;
    });
  };

  const toggleHiddenEverywhere = (href: string) => {
    updateEntry(href, (current = {}) => {
      const next: NavConfigEntry = { ...current };
      next.hidden = !current.hidden;
      if (!next.hidden) delete next.hidden;
      if (!next.label && !next.hiddenForRoles?.length && !next.hidden && !next.order && !next.editRoles?.length)
        return undefined;
      return next;
    });
  };

  const toggleEditRole = (href: string, role: OrgRole) => {
    updateEntry(href, (current = {}) => {
      const existing = Array.isArray(current.editRoles) ? [...current.editRoles] : [];
      const hasRole = existing.includes(role);
      const nextRoles = hasRole ? existing.filter((r) => r !== role) : [...existing, role];
      const next: NavConfigEntry = { ...current, editRoles: Array.from(new Set([...nextRoles, "admin"])) };
      const editCount = next.editRoles?.length ?? 0;
      if (editCount === 0 || (editCount === 1 && next.editRoles?.[0] === "admin")) delete next.editRoles;
      const hasHiddenRoles = !!next.hiddenForRoles?.length;
      const hasEditRoles = !!next.editRoles?.length;
      if (!next.label && !next.hidden && !hasHiddenRoles && !hasEditRoles && !next.order) return undefined;
      return next;
    });
  };

  const moveItem = (href: string, direction: "up" | "down") => {
    const currentIndex = orderedItems.findIndex((item) => item.href === href);
    if (currentIndex === -1) return;
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= orderedItems.length) return;
    const newItems = [...orderedItems];
    [newItems[currentIndex], newItems[newIndex]] = [newItems[newIndex], newItems[currentIndex]];
    setOrderedItems(newItems);
    setLocalConfig((prev) => {
      const updated = { ...prev };
      newItems.forEach((item, index) => {
        const key = getConfigKey(item.href);
        if (!updated[key]) updated[key] = {};
        updated[key] = { ...updated[key], order: index };
      });
      return updated;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    const result = await saveNavConfig(localConfig);
    if (result.success) {
      setHasChanges(false);
      Alert.alert("Saved", "Navigation settings updated successfully.");
    } else {
      Alert.alert("Error", result.error || "Failed to save navigation settings");
    }
  };

  // Show loading while checking role
  if (roleLoading || loading) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.replace(`/(app)/${orgSlug}/settings`)} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Navigation</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={SEMANTIC.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Non-admin: show access denied
  if (!isAdmin) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.replace(`/(app)/${orgSlug}/settings`)} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Navigation</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Admin Access Required</Text>
            <Text style={styles.emptyText}>You need admin permissions to manage navigation settings.</Text>
          </View>
        </View>
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
            <Pressable onPress={() => router.replace(`/(app)/${orgSlug}/settings`)} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Navigation</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />}
        >
          {/* Description */}
          <View style={styles.descriptionSection}>
            <Text style={styles.descriptionText}>
              Use arrows to reorder tabs, rename them, or hide them from members and alumni.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

        {/* Nav Items List */}
        <View style={styles.itemsList}>
          {orderedItems.map((item, index) => {
            const configKey = getConfigKey(item.href);
            const entry = localConfig[configKey];
            const labelValue = typeof entry?.label === "string" ? entry.label : "";
            const hiddenForRoles = Array.isArray(entry?.hiddenForRoles) ? (entry.hiddenForRoles as OrgRole[]) : [];
            const isHiddenEverywhere = entry?.hidden === true;
            const editRoles = Array.isArray(entry?.editRoles) ? (entry.editRoles as OrgRole[]) : ["admin"];
            const isExpanded = expandedItem === item.href;
            const isFirst = index === 0;
            const isLast = index === orderedItems.length - 1;
            const Icon = item.icon;

            return (
              <View
                key={configKey}
                style={[styles.itemCard, isHiddenEverywhere && styles.itemCardDisabled]}
              >
                {/* Item Header */}
                <View style={styles.itemHeader}>
                  {/* Reorder Buttons */}
                  <View style={styles.reorderButtons}>
                    <Pressable
                      onPress={() => moveItem(item.href, "up")}
                      disabled={isFirst}
                      style={[styles.reorderButton, isFirst && styles.reorderButtonDisabled]}
                    >
                      <ChevronUp size={18} color={isFirst ? NEUTRAL.border : NEUTRAL.muted} />
                    </Pressable>
                    <Pressable
                      onPress={() => moveItem(item.href, "down")}
                      disabled={isLast}
                      style={[styles.reorderButton, isLast && styles.reorderButtonDisabled]}
                    >
                      <ChevronDown size={18} color={isLast ? NEUTRAL.border : NEUTRAL.muted} />
                    </Pressable>
                  </View>

                  {/* Icon */}
                  <Icon size={20} color={NEUTRAL.muted} />

                  {/* Label */}
                  <View style={styles.itemLabelContainer}>
                    <Text style={styles.itemLabel}>{labelValue || item.label}</Text>
                    {labelValue && labelValue !== item.label && (
                      <Text style={styles.itemLabelOriginal}>({item.label})</Text>
                    )}
                  </View>

                  {/* Status Badges */}
                  <View style={styles.badgesContainer}>
                    {isHiddenEverywhere && (
                      <View style={[styles.badge, styles.badgeError]}>
                        <Text style={styles.badgeErrorText}>Disabled</Text>
                      </View>
                    )}
                    {hiddenForRoles.length > 0 && !isHiddenEverywhere && (
                      <View style={[styles.badge, styles.badgeWarning]}>
                        <Text style={styles.badgeWarningText}>Partial</Text>
                      </View>
                    )}
                  </View>

                  {/* Expand Button */}
                  <Pressable
                    onPress={() => setExpandedItem(isExpanded ? null : item.href)}
                    style={styles.expandButton}
                  >
                    <ChevronDown
                      size={20}
                      color={NEUTRAL.muted}
                      style={{ transform: [{ rotate: isExpanded ? "180deg" : "0deg" }] }}
                    />
                  </Pressable>
                </View>

                {/* Expanded Content */}
                {isExpanded && (
                  <View style={styles.expandedContent}>
                    {/* Display Name */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Display name</Text>
                      <TextInput
                        style={styles.input}
                        value={labelValue}
                        onChangeText={(text) => handleLabelChange(item.href, text)}
                        placeholder={item.label}
                        placeholderTextColor={NEUTRAL.placeholder}
                      />
                    </View>

                    {/* Visibility */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Visibility</Text>
                      <Pressable
                        style={styles.checkboxRow}
                        onPress={() => toggleRoleHidden(item.href, "active_member")}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            hiddenForRoles.includes("active_member") && styles.checkboxChecked,
                          ]}
                        >
                          {hiddenForRoles.includes("active_member") && (
                            <Check size={14} color={NEUTRAL.surface} />
                          )}
                        </View>
                        <Text style={styles.checkboxLabel}>Hide from members</Text>
                      </Pressable>
                      <Pressable
                        style={styles.checkboxRow}
                        onPress={() => toggleRoleHidden(item.href, "alumni")}
                      >
                        <View
                          style={[styles.checkbox, hiddenForRoles.includes("alumni") && styles.checkboxChecked]}
                        >
                          {hiddenForRoles.includes("alumni") && (
                            <Check size={14} color={NEUTRAL.surface} />
                          )}
                        </View>
                        <Text style={styles.checkboxLabel}>Hide from alumni</Text>
                      </Pressable>
                      <Pressable
                        style={styles.checkboxRow}
                        onPress={() => toggleHiddenEverywhere(item.href)}
                      >
                        <View style={[styles.checkbox, isHiddenEverywhere && styles.checkboxChecked]}>
                          {isHiddenEverywhere && <Check size={14} color={NEUTRAL.surface} />}
                        </View>
                        <Text style={styles.checkboxLabel}>Disable for everyone</Text>
                      </Pressable>
                    </View>

                    {/* Edit Roles */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Who can edit?</Text>
                      <View style={styles.editRolesRow}>
                        <View style={[styles.checkboxRow, styles.checkboxRowInline]}>
                          <View style={[styles.checkbox, styles.checkboxChecked, styles.checkboxDisabled]}>
                            <Check size={14} color={NEUTRAL.surface} />
                          </View>
                          <Text style={styles.checkboxLabel}>Admins</Text>
                        </View>
                        <Pressable
                          style={[styles.checkboxRow, styles.checkboxRowInline]}
                          onPress={() => toggleEditRole(item.href, "active_member")}
                        >
                          <View
                            style={[
                              styles.checkbox,
                              editRoles.includes("active_member") && styles.checkboxChecked,
                            ]}
                          >
                            {editRoles.includes("active_member") && (
                              <Check size={14} color={NEUTRAL.surface} />
                            )}
                          </View>
                          <Text style={styles.checkboxLabel}>Members</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.checkboxRow, styles.checkboxRowInline]}
                          onPress={() => toggleEditRole(item.href, "alumni")}
                        >
                          <View
                            style={[styles.checkbox, editRoles.includes("alumni") && styles.checkboxChecked]}
                          >
                            {editRoles.includes("alumni") && (
                              <Check size={14} color={NEUTRAL.surface} />
                            )}
                          </View>
                          <Text style={styles.checkboxLabel}>Alumni</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

          {/* Save Button */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.saveButton, (!hasChanges || saving) && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!hasChanges || saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={NEUTRAL.surface} />
              ) : (
                <Text style={styles.saveButtonText}>Save changes</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    // Header styles
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600",
      color: APP_CHROME.headerTitle,
      textAlign: "center",
    },
    headerSpacer: {
      width: 40, // Match back button width for centering
    },
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    descriptionSection: {
      marginBottom: SPACING.md,
    },
    descriptionText: {
      fontSize: 14,
      color: NEUTRAL.muted,
      lineHeight: 20,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
    },
    loadingText: {
      fontSize: 14,
      color: NEUTRAL.muted,
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.lg,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    emptyText: {
      fontSize: 14,
      color: NEUTRAL.muted,
      textAlign: "center",
    },
    errorBanner: {
      backgroundColor: SEMANTIC.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
      marginBottom: SPACING.md,
    },
    errorText: {
      fontSize: 14,
      color: SEMANTIC.error,
    },
    itemsList: {
      gap: SPACING.sm,
    },
    itemCard: {
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      overflow: "hidden",
    },
    itemCardDisabled: {
      opacity: 0.6,
      borderColor: SEMANTIC.error + "40",
    },
    itemHeader: {
      flexDirection: "row",
      alignItems: "center",
      padding: SPACING.sm,
      gap: 10,
    },
    reorderButtons: {
      gap: 2,
    },
    reorderButton: {
      padding: 4,
    },
    reorderButtonDisabled: {
      opacity: 0.3,
    },
    itemLabelContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    itemLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: NEUTRAL.foreground,
    },
    itemLabelOriginal: {
      fontSize: 13,
      color: NEUTRAL.muted,
    },
    badgesContainer: {
      flexDirection: "row",
      gap: 6,
    },
    badge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: RADIUS.xs,
    },
    badgeError: {
      backgroundColor: SEMANTIC.errorLight,
    },
    badgeErrorText: {
      fontSize: 11,
      fontWeight: "600",
      color: SEMANTIC.error,
    },
    badgeWarning: {
      backgroundColor: SEMANTIC.warningLight,
    },
    badgeWarningText: {
      fontSize: 11,
      fontWeight: "600",
      color: SEMANTIC.warning,
    },
    expandButton: {
      padding: 4,
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: NEUTRAL.border,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    fieldGroup: {
      gap: SPACING.sm,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: NEUTRAL.foreground,
    },
    input: {
      backgroundColor: NEUTRAL.surface,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingVertical: 10,
      paddingHorizontal: 14,
      fontSize: 15,
      color: NEUTRAL.foreground,
    },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    checkboxRowInline: {
      paddingVertical: 0,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: RADIUS.xs,
      borderWidth: 2,
      borderColor: NEUTRAL.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxChecked: {
      backgroundColor: SEMANTIC.success,
      borderColor: SEMANTIC.success,
    },
    checkboxDisabled: {
      opacity: 0.6,
    },
    checkboxLabel: {
      fontSize: 14,
      color: NEUTRAL.foreground,
    },
    editRolesRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.md,
    },
    footer: {
      marginTop: SPACING.lg,
    },
    saveButton: {
      backgroundColor: SEMANTIC.success,
      paddingVertical: 14,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: "600",
      color: NEUTRAL.surface,
    },
  });
