import { useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  TextInput,
  Keyboard,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { SearchX, Search, X } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { SearchResultCard } from "@/components/search";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import type { SearchResult } from "@/hooks/useGlobalSearch";

export default function SearchScreen() {
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { neutral } = useAppColorScheme();
  const { query, setQuery, results, loading } = useGlobalSearch(orgId, orgSlug);
  const inputRef = useRef<TextInput>(null);

  const styles = useThemedStyles((n) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    headerWrap: {
      backgroundColor: n.surface,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      paddingBottom: SPACING.sm,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    grabber: {
      alignSelf: "center" as const,
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: n.border,
      marginBottom: SPACING.sm,
      opacity: 0.6,
    },
    searchRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    inputPill: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      backgroundColor: n.background,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.sm + 2,
      height: 38,
    },
    input: {
      flex: 1,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      paddingVertical: 0,
      // RN sometimes adds vertical padding on iOS — pin it
      ...(Platform.OS === "ios" ? { lineHeight: undefined } : null),
    },
    clearBtn: {
      padding: 4,
      borderRadius: RADIUS.full,
      backgroundColor: n.border,
      opacity: 0.85,
    },
    cancelBtn: {
      paddingHorizontal: SPACING.xs,
      paddingVertical: SPACING.xs,
    },
    cancelText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "500" as const,
    },
    list: {
      flex: 1,
    },
    centerState: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingTop: SPACING.xxxl,
      paddingHorizontal: SPACING.xl,
      gap: SPACING.xs,
    },
    stateTitle: {
      ...TYPOGRAPHY.bodyMedium,
      fontWeight: "600" as const,
      color: n.foreground,
      textAlign: "center" as const,
      marginTop: SPACING.sm,
    },
    stateText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      textAlign: "center" as const,
    },
    loadingRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.md,
    },
    loadingText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    footer: {
      height: SPACING.xl,
    },
  }));

  const handleResultPress = (result: SearchResult) => {
    Keyboard.dismiss();
    switch (result.type) {
      case "member":
        router.push(`/(app)/(drawer)/${orgSlug}/members/${result.id}` as any);
        break;
      case "alumni":
        router.push(`/(app)/(drawer)/${orgSlug}/alumni/${result.id}` as any);
        break;
      case "event":
        router.push(`/(app)/(drawer)/${orgSlug}/events/${result.id}` as any);
        break;
      case "announcement":
        router.push(`/(app)/(drawer)/${orgSlug}/announcements/${result.id}` as any);
        break;
      case "discussion_thread":
        router.push(`/(app)/(drawer)/${orgSlug}/chat/threads/${result.id}` as any);
        break;
      case "job_posting":
        router.push(`/(app)/(drawer)/${orgSlug}/jobs/${result.id}` as any);
        break;
    }
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    router.back();
  };

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const showEmpty = query.length < 2 && !loading;
  const showNoResults = query.length >= 2 && !loading && results.length === 0;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: neutral.surface }}>
        <Animated.View
          entering={FadeInDown.duration(280).springify().damping(18)}
          style={styles.headerWrap}
        >
          <View style={styles.grabber} />
          <View style={styles.searchRow}>
            <View style={styles.inputPill}>
              <Search size={18} color={neutral.muted} strokeWidth={2} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search members, events, posts, jobs…"
                placeholderTextColor={neutral.muted}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.input}
                clearButtonMode="never"
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={handleClear}
                  style={styles.clearBtn}
                  hitSlop={8}
                  accessibilityLabel="Clear search"
                >
                  <X size={12} color={neutral.surface} strokeWidth={3} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={handleCancel}
              style={styles.cancelBtn}
              hitSlop={8}
              accessibilityLabel="Cancel search"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>

      <Animated.View entering={FadeIn.duration(220).delay(120)} style={styles.list}>
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <SearchResultCard result={item} index={index} onPress={handleResultPress} />
          )}
          ListHeaderComponent={
            loading && results.length > 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={neutral.muted} />
                <Text style={styles.loadingText}>Searching…</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.centerState}>
                <ActivityIndicator size="small" color={neutral.muted} />
              </View>
            ) : showEmpty ? (
              <View style={styles.centerState}>
                <Search size={28} color={neutral.border} strokeWidth={1.75} />
                <Text style={styles.stateTitle}>Search your organization</Text>
                <Text style={styles.stateText}>
                  Find members, events, posts, jobs, and more
                </Text>
              </View>
            ) : showNoResults ? (
              <View style={styles.centerState}>
                <SearchX size={28} color={neutral.border} strokeWidth={1.75} />
                <Text style={styles.stateTitle}>No matches</Text>
                <Text style={styles.stateText}>Try a different search term</Text>
              </View>
            ) : null
          }
          ListFooterComponent={<View style={styles.footer} />}
        />
      </Animated.View>
    </View>
  );
}
