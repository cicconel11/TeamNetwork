import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SearchX, Search } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { SearchResultCard } from "@/components/search";
import { SPACING } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import type { SearchResult } from "@/hooks/useGlobalSearch";

export default function SearchScreen() {
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { neutral, semantic } = useAppColorScheme();
  const { query, setQuery, results, loading } = useGlobalSearch(orgId);
  const styles = useThemedStyles((n, s) => ({
    list: {
      flex: 1,
      backgroundColor: n.background,
    },
    centerState: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingTop: SPACING.xxxl,
      paddingHorizontal: SPACING.xl,
      gap: SPACING.sm,
    },
    stateTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      textAlign: "center" as const,
      marginTop: SPACING.xs,
    },
    stateText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      textAlign: "center" as const,
    },
    footer: {
      height: SPACING.xl,
    },
  }));

  const handleResultPress = (result: SearchResult) => {
    switch (result.type) {
      case "member":
        router.push(`/(app)/(drawer)/${orgSlug}/members/${result.id}` as any);
        break;
      case "event":
        router.push(`/(app)/(drawer)/${orgSlug}/events/${result.id}` as any);
        break;
      case "announcement":
        router.push(`/(app)/(drawer)/${orgSlug}/announcements/${result.id}` as any);
        break;
    }
  };

  const showEmpty = query.length < 2 && !loading;
  const showNoResults = query.length >= 2 && !loading && results.length === 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Search",
          headerSearchBarOptions: {
            placeholder: "Search members, events, announcements…",
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            autoFocus: true,
            cancelButtonText: "Cancel",
          },
        }}
      />

      <FlatList
        data={results}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <SearchResultCard result={item} index={index} onPress={handleResultPress} />
        )}
        ListHeaderComponent={
          loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="small" color={semantic.success} />
              <Text style={styles.stateText}>Searching…</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            showEmpty ? (
              <View style={styles.centerState}>
                <Search size={40} color={neutral.border} />
                <Text style={styles.stateTitle}>Search your organization</Text>
                <Text style={styles.stateText}>
                  Find members, events, and announcements
                </Text>
              </View>
            ) : showNoResults ? (
              <View style={styles.centerState}>
                <SearchX size={40} color={neutral.border} />
                <Text style={styles.stateTitle}>No results found</Text>
                <Text style={styles.stateText}>
                  Try a different search term
                </Text>
              </View>
            ) : null
          ) : null
        }
        ListFooterComponent={<View style={styles.footer} />}
        style={styles.list}
      />
    </>
  );
}
