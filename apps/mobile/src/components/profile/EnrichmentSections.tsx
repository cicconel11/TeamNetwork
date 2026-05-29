import { View, Text, StyleSheet } from "react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const COLORS = {
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  card: "#f8fafc",
  mutedSurface: "#f1f5f9",
};

interface CertificationEntry {
  name?: string | null;
  authority?: string | null;
  issued_on?: string | null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function toCertifications(value: unknown): CertificationEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is CertificationEntry => Boolean(c) && typeof c === "object" && !Array.isArray(c))
    .filter((c) => typeof c.name === "string" && c.name.trim() !== "");
}

/**
 * Renders Skills, Languages, and Certifications from the enrichment columns.
 * Returns null when all are empty. Shared by the mobile alumni + member detail
 * screens.
 */
export function EnrichmentSections({
  skills,
  languages,
  certifications,
}: {
  skills?: unknown;
  languages?: unknown;
  certifications?: unknown;
}) {
  const skillList = toStringList(skills);
  const languageList = toStringList(languages);
  const certList = toCertifications(certifications);

  if (skillList.length === 0 && languageList.length === 0 && certList.length === 0) return null;

  return (
    <>
      {skillList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Skills</Text>
          <View style={styles.chipsRow}>
            {skillList.map((skill, i) => (
              <View key={`${skill}-${i}`} style={styles.chip}>
                <Text style={styles.chipText}>{skill}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {languageList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Languages</Text>
          <View style={styles.chipsRow}>
            {languageList.map((lang, i) => (
              <View key={`${lang}-${i}`} style={styles.chip}>
                <Text style={styles.chipText}>{lang}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {certList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Certifications</Text>
          {certList.map((cert, i) => (
            <Text key={`${cert.name ?? "cert"}-${i}`} style={styles.certText}>
              {cert.name}
              {[cert.authority, cert.issued_on].filter(Boolean).length > 0
                ? ` • ${[cert.authority, cert.issued_on].filter(Boolean).join(" · ")}`
                : ""}
            </Text>
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
  label: {
    ...TYPOGRAPHY.overline,
    color: COLORS.secondaryText,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.xs,
  },
  chip: {
    backgroundColor: COLORS.mutedSurface,
    borderRadius: RADIUS.sm,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
  },
  chipText: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.primaryText,
  },
  certText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.primaryText,
    marginBottom: 4,
  },
});
