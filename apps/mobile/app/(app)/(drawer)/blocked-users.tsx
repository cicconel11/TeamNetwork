import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ShieldOff } from "lucide-react-native";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useBlockedUsers } from "@/contexts/BlockedUsersContext";
import {
  BlockedListItem,
  type BlockedListItemUser,
} from "@/components/moderation/BlockedListItem";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";

interface BlockedUserRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ currentSlug?: string }>();
  const { neutral } = useAppColorScheme();
  const { blockedUserIds, toggleBlock, refresh } = useBlockedUsers();
  const isMountedRef = useRef(true);

  const [profiles, setProfiles] = useState<Record<string, BlockedUserRow>>({});
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const idsKey = useMemo(
    () => Array.from(blockedUserIds).sort().join(","),
    [blockedUserIds],
  );

  useEffect(() => {
    const ids = Array.from(blockedUserIds);
    if (ids.length === 0) {
      setProfiles({});
      setLoadingProfiles(false);
      return;
    }

    setLoadingProfiles(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id, name, avatar_url")
          .in("id", ids);

        if (error) throw error;
        if (!isMountedRef.current) return;

        const map: Record<string, BlockedUserRow> = {};
        for (const row of (data ?? []) as BlockedUserRow[]) {
          map[row.id] = row;
        }
        setProfiles(map);
      } catch (err) {
        sentry.captureException(err as Error, {
          context: "BlockedUsersScreen.fetchProfiles",
        });
        if (isMountedRef.current) {
          showToast("Couldn't load blocked users", "error");
        }
      } finally {
        if (isMountedRef.current) setLoadingProfiles(false);
      }
    })();
  }, [idsKey, blockedUserIds]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (params.currentSlug) {
      router.replace(`/(app)/${params.currentSlug}/(tabs)`);
      return;
    }
    router.replace("/(app)");
  }, [params.currentSlug, router]);

  const handleUnblock = useCallback(
    async (userId: string) => {
      setPendingUserId(userId);
      try {
        await toggleBlock(userId);
        showToast("Unblocked", "success");
        void refresh();
      } catch (err) {
        const message = (err as Error).message || "Failed to unblock";
        showToast(message, "error");
        sentry.captureException(err as Error, {
          context: "BlockedUsersScreen.unblock",
          userId,
        });
      } finally {
        if (isMountedRef.current) setPendingUserId(null);
      }
    },
    [toggleBlock, refresh],
  );

  const styles = useThemedStyles((n) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 36,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
    },
    emptyWrap: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.xxl,
      gap: SPACING.sm,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: n.background,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 1,
      borderColor: n.border,
      marginBottom: SPACING.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      textAlign: "center" as const,
      paddingHorizontal: SPACING.lg,
    },
    intro: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginBottom: SPACING.md,
      paddingHorizontal: SPACING.xs,
    },
    loadingWrap: {
      paddingVertical: SPACING.xl,
      alignItems: "center" as const,
    },
  }));

  const ids = Array.from(blockedUserIds);
  const items: BlockedListItemUser[] = ids.map((id) => {
    const profile = profiles[id];
    return {
      id,
      full_name: profile?.name ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Blocked Users</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {ids.length > 0 && (
            <Text style={styles.intro}>
              You won&apos;t see content from blocked users, and they won&apos;t see yours. Tap Unblock to restore visibility.
            </Text>
          )}

          {loadingProfiles && ids.length > 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={neutral.foreground} />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <ShieldOff size={24} color={neutral.secondary} />
              </View>
              <Text style={styles.emptyTitle}>No blocked users</Text>
              <Text style={styles.emptySubtitle}>
                When you block someone, they&apos;ll show up here so you can unblock them later.
              </Text>
            </View>
          ) : (
            items.map((u) => (
              <BlockedListItem
                key={u.id}
                user={u}
                loading={pendingUserId === u.id}
                onUnblock={handleUnblock}
              />
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}
