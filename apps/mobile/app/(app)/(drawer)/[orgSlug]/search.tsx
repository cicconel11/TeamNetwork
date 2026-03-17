import { View, Text, FlatList, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SearchX, Search } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { SearchResultCard } from "@/components/search";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { SearchResult } from "@/hooks/useGlobalSearch";

export default function SearchScreen() {
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { query, setQuery, results, loading } = useGlobalSearch(orgId);

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
              <ActivityIndicator size="small" color={SEMANTIC.success} />
              <Text style={styles.stateText}>Searching…</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            showEmpty ? (
              <View style={styles.centerState}>
                <Search size={40} color={NEUTRAL.border} />
                <Text style={styles.stateTitle}>Search your organization</Text>
                <Text style={styles.stateText}>
                  Find members, events, and announcements
                </Text>
              </View>
            ) : showNoResults ? (
              <View style={styles.centerState}>
                <SearchX size={40} color={NEUTRAL.border} />
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

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: SPACING.xxxl,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  stateTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    textAlign: "center",
    marginTop: SPACING.xs,
  },
  stateText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    textAlign: "center",
  },
  footer: {
    height: SPACING.xl,
  },
});
