import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useNavConfig, type NavConfig, type NavConfigEntry } from "@/hooks/useNavConfig";
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { OrgRole } from "@teammeet/core";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
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

// Get config key for nav item (Dashboard has empty href)
const getConfigKey = (href: string) => (href === "" ? "dashboard" : href);

export default function NavigationSettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();

  const { navConfig, loading, saving, error, saveNavConfig, refetch } = useNavConfig(orgSlug);

  // Local state
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [localConfig, setLocalConfig] = useState<NavConfig>({});
  const [orderedItems, setOrderedItems] = useState(CONFIGURABLE_ITEMS);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {}
  }, [navigation]);

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
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Navigation</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator color={SEMANTIC.success} />
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
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Navigation</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>Admin Access Required</Text>
            <Text style={styles.emptyText}>You need admin permissions to manage navigation settings.</Text>
          </View>
        </View>
      </View>
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
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Navigation</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Customize Navigation</Text>
            <Text style={styles.formSubtitle}>
              Use arrows to reorder tabs, rename them, or hide them from members and alumni.
            </Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
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
                      <TouchableOpacity
                        onPress={() => moveItem(item.href, "up")}
                        disabled={isFirst}
                        style={[styles.reorderButton, isFirst && styles.reorderButtonDisabled]}
                      >
                        <ChevronUp size={18} color={isFirst ? NEUTRAL.disabled : NEUTRAL.muted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveItem(item.href, "down")}
                        disabled={isLast}
                        style={[styles.reorderButton, isLast && styles.reorderButtonDisabled]}
                      >
                        <ChevronDown size={18} color={isLast ? NEUTRAL.disabled : NEUTRAL.muted} />
                      </TouchableOpacity>
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
                    <TouchableOpacity
                      onPress={() => setExpandedItem(isExpanded ? null : item.href)}
                      style={styles.expandButton}
                    >
                      <ChevronDown
                        size={20}
                        color={NEUTRAL.muted}
                        style={{ transform: [{ rotate: isExpanded ? "180deg" : "0deg" }] }}
                      />
                    </TouchableOpacity>
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
                        <TouchableOpacity
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
                              <Check size={14} color="#ffffff" />
                            )}
                          </View>
                          <Text style={styles.checkboxLabel}>Hide from members</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.checkboxRow}
                          onPress={() => toggleRoleHidden(item.href, "alumni")}
                        >
                          <View
                            style={[styles.checkbox, hiddenForRoles.includes("alumni") && styles.checkboxChecked]}
                          >
                            {hiddenForRoles.includes("alumni") && (
                              <Check size={14} color="#ffffff" />
                            )}
                          </View>
                          <Text style={styles.checkboxLabel}>Hide from alumni</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.checkboxRow}
                          onPress={() => toggleHiddenEverywhere(item.href)}
                        >
                          <View style={[styles.checkbox, isHiddenEverywhere && styles.checkboxChecked]}>
                            {isHiddenEverywhere && <Check size={14} color="#ffffff" />}
                          </View>
                          <Text style={styles.checkboxLabel}>Disable for everyone</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Edit Roles */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Who can edit?</Text>
                        <View style={styles.editRolesRow}>
                          <View style={[styles.checkboxRow, styles.checkboxRowInline]}>
                            <View style={[styles.checkbox, styles.checkboxChecked, styles.checkboxDisabled]}>
                              <Check size={14} color="#ffffff" />
                            </View>
                            <Text style={styles.checkboxLabel}>Admins</Text>
                          </View>
                          <TouchableOpacity
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
                                <Check size={14} color="#ffffff" />
                              )}
                            </View>
                            <Text style={styles.checkboxLabel}>Members</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.checkboxRow, styles.checkboxRowInline]}
                            onPress={() => toggleEditRole(item.href, "alumni")}
                          >
                            <View
                              style={[styles.checkbox, editRoles.includes("alumni") && styles.checkboxChecked]}
                            >
                              {editRoles.includes("alumni") && (
                                <Check size={14} color="#ffffff" />
                              )}
                            </View>
                            <Text style={styles.checkboxLabel}>Alumni</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Save Button */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              (!hasChanges || saving) && styles.buttonDisabled,
            ]}
            onPress={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {
    // Gradient fills this area
  },
  headerSafeArea: {
    // SafeAreaView handles top inset
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  orgLogoButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  orgLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  orgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  orgAvatarText: {
    ...TYPOGRAPHY.titleMedium,
    color: APP_CHROME.headerTitle,
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.lg,
  },
  loadingText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  emptyTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    textAlign: "center",
  },
  formHeader: {
    gap: SPACING.xs,
  },
  formTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
  },
  formSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
  },
  errorCard: {
    backgroundColor: SEMANTIC.errorLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: SEMANTIC.error,
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
  },
  itemsList: {
    gap: SPACING.sm,
  },
  itemCard: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    overflow: "hidden",
  },
  itemCardDisabled: {
    opacity: 0.6,
    borderColor: SEMANTIC.error,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.sm,
    gap: SPACING.sm,
  },
  reorderButtons: {
    gap: SPACING.xxs,
  },
  reorderButton: {
    padding: SPACING.xs,
  },
  reorderButtonDisabled: {
    opacity: 0.3,
  },
  itemLabelContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  itemLabel: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  itemLabelOriginal: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
  badgesContainer: {
    flexDirection: "row",
    gap: SPACING.xs,
  },
  badge: {
    paddingVertical: SPACING.xxs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.xs,
  },
  badgeError: {
    backgroundColor: SEMANTIC.errorLight,
  },
  badgeErrorText: {
    ...TYPOGRAPHY.labelSmall,
    color: SEMANTIC.error,
  },
  badgeWarning: {
    backgroundColor: SEMANTIC.warningLight,
  },
  badgeWarningText: {
    ...TYPOGRAPHY.labelSmall,
    color: SEMANTIC.warning,
  },
  expandButton: {
    padding: SPACING.xs,
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
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
  },
  input: {
    backgroundColor: NEUTRAL.background,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
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
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
  },
  editRolesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.md,
  },
  primaryButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.sm,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
