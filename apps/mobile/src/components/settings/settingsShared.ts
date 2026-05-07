import { formatMonthDayYearSafe } from "@/lib/date-format";
import { useThemedStyles } from "@/hooks/useThemedStyles";

export { fontSize, fontWeight, spacing } from "@/lib/theme";

export function formatDate(dateString: string | null): string {
  return formatMonthDayYearSafe(dateString, "N/A");
}

export function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

export function useBaseStyles() {
  return useThemedStyles((n, _s) => ({
    section: {
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    sectionHeaderLeft: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: n.foreground,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: 12,
      padding: 16,
    },
    divider: {
      height: 1,
      backgroundColor: n.border,
      marginVertical: 16,
    },
    loadingContainer: {
      padding: 24,
      alignItems: "center" as const,
      gap: 8,
    },
  }));
}
