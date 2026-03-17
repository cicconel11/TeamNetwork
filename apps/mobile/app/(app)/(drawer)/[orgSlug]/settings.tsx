import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Info } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { captureException } from "@/lib/analytics";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL } from "@/lib/design-tokens";
import Constants from "expo-constants";
import {
  SettingsOrganizationSection,
  SettingsNotificationsSection,
  SettingsInvitesSection,
  SettingsAccessSection,
  SettingsBillingSection,
  SettingsDangerSection,
  SETTINGS_COLORS,
} from "@/components/settings";

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { refetch: refetchSubscription } = useSubscription(orgId);
  const styles = useMemo(() => createStyles(), []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
        captureException(e as Error, { screen: "Settings", context: "fetchRole", orgId });
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchSubscription();
    setRefreshing(false);
  }, [refetchSubscription]);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available — no-op
    }
  }, [navigation]);

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
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Settings</Text>
              <Text style={styles.headerMeta}>{orgName}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={SETTINGS_COLORS.primary}
            />
          }
        >
          {!roleLoading && orgId && (
            <>
              <SettingsOrganizationSection
                orgId={orgId}
                isAdmin={isAdmin}
                colors={SETTINGS_COLORS}
              />

              <SettingsNotificationsSection
                orgId={orgId}
                colors={SETTINGS_COLORS}
              />

              <SettingsInvitesSection
                orgId={orgId}
                isAdmin={isAdmin}
                colors={SETTINGS_COLORS}
              />

              <SettingsAccessSection
                orgId={orgId}
                isAdmin={isAdmin}
                colors={SETTINGS_COLORS}
              />

              <SettingsBillingSection
                orgId={orgId}
                orgSlug={orgSlug}
                isAdmin={isAdmin}
                colors={SETTINGS_COLORS}
              />

              <SettingsDangerSection
                orgId={orgId}
                orgSlug={orgSlug}
                isAdmin={isAdmin}
                colors={SETTINGS_COLORS}
              />
            </>
          )}

          <View style={styles.section}>
            <View style={styles.card}>
              <View style={styles.aboutRow}>
                <Info size={20} color={SETTINGS_COLORS.muted} />
                <Text style={styles.aboutLabel}>App Version</Text>
                <Text style={styles.aboutValue}>{Constants.expoConfig?.version || "1.0.0"}</Text>
              </View>
            </View>
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
      backgroundColor: SETTINGS_COLORS.background,
    },
    headerGradient: {
      paddingBottom: 16,
    },
    headerSafeArea: {
      flex: 0,
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 8,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
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
      fontSize: 16,
      fontWeight: "600",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: 12,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    section: {
      marginBottom: 16,
    },
    card: {
      backgroundColor: SETTINGS_COLORS.card,
      borderRadius: 12,
      padding: 16,
      borderCurve: "continuous",
    },
    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    aboutLabel: {
      flex: 1,
      fontSize: 16,
      color: SETTINGS_COLORS.foreground,
    },
    aboutValue: {
      fontSize: 14,
      color: SETTINGS_COLORS.muted,
    },
  });
