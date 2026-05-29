import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Briefcase, GraduationCap } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { WorkHistoryEntry, EducationEntry } from "@/hooks/useAlumniDetail";

const COLORS = {
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#f8fafc",
  mutedSurface: "#f1f5f9",
};

/**
 * Renders Experience + Education from the Apify-normalized `work_history` /
 * `education_history` arrays, including per-entry company/school logos. Returns
 * null when both are empty. Shared by the mobile alumni + member detail screens.
 */
export function EnrichmentHistory({
  workHistory,
  educationHistory,
}: {
  workHistory?: WorkHistoryEntry[] | null;
  educationHistory?: EducationEntry[] | null;
}) {
  const work = (workHistory ?? []).filter(Boolean);
  const education = (educationHistory ?? []).filter(Boolean);

  if (work.length === 0 && education.length === 0) return null;

  return (
    <>
      {work.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Experience</Text>
          {work.map((job, i) => (
            <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
              {job.company_logo_url ? (
                <Image source={job.company_logo_url} style={styles.logo} contentFit="cover" transition={200} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Briefcase size={18} color={COLORS.mutedText} />
                </View>
              )}
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>{job.title || "Position"}</Text>
                {(job.company || job.location) && (
                  <Text style={styles.rowSubtitle}>
                    {[job.company, job.location].filter(Boolean).join(" · ")}
                  </Text>
                )}
                {(job.start_date || job.end_date) && (
                  <Text style={styles.rowMeta}>
                    {job.start_date || "?"} – {job.end_date || "Present"}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {education.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Education</Text>
          {education.map((edu, i) => (
            <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
              {edu.institute_logo_url ? (
                <Image source={edu.institute_logo_url} style={styles.logo} contentFit="cover" transition={200} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <GraduationCap size={18} color={COLORS.mutedText} />
                </View>
              )}
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>{edu.title || "School"}</Text>
                {(edu.degree || edu.field_of_study) && (
                  <Text style={styles.rowSubtitle}>
                    {[edu.degree, edu.field_of_study].filter(Boolean).join(", ")}
                  </Text>
                )}
                {(edu.start_year || edu.end_year) && (
                  <Text style={styles.rowMeta}>
                    {edu.start_year || "?"} – {edu.end_year || "Present"}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  sectionLabel: {
    ...TYPOGRAPHY.overline,
    color: COLORS.secondaryText,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  row: {
    flexDirection: "row",
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.mutedSurface,
  },
  logoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.mutedSurface,
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    ...TYPOGRAPHY.labelLarge,
    color: COLORS.primaryText,
    fontWeight: "600",
  },
  rowSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.secondaryText,
    marginTop: 1,
  },
  rowMeta: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.mutedText,
    marginTop: 2,
  },
});
