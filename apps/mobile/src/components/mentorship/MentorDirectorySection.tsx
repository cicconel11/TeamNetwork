import React, { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, Linking, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import { MentorProfileForm } from "./MentorProfileForm";
import { MentorRequestSheet } from "./MentorRequestSheet";
import type {
  MentorDirectoryEntry,
  MentorProfileRecord,
  MentorProfileSuggestedDefaults,
  SelectOption,
} from "@/types/mentorship";

export function MentorDirectorySection({
  mentors,
  industries,
  years,
  showRegistration,
  currentUserProfile,
  suggestedDefaults,
  onRefresh,
  canRequest,
  orgId,
  pendingMentorIds,
}: {
  mentors: MentorDirectoryEntry[];
  industries: string[];
  years: number[];
  showRegistration: boolean;
  currentUserProfile: MentorProfileRecord | null;
  suggestedDefaults: MentorProfileSuggestedDefaults | null;
  onRefresh: () => void;
  canRequest?: boolean;
  orgId?: string | null;
  pendingMentorIds?: Set<string>;
}) {
  const styles = useThemedStyles(createStyles);
  const [filters, setFilters] = useState({
    nameSearch: "",
    industry: "",
    year: "",
  });
  const [activeSelect, setActiveSelect] = useState<"industry" | "year" | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [requestMentor, setRequestMentor] = useState<MentorDirectoryEntry | null>(null);

  const filteredMentors = useMemo(() => {
    const nameQuery = filters.nameSearch.trim().toLowerCase();
    return mentors.filter((mentor) => {
      if (nameQuery && !mentor.name.toLowerCase().includes(nameQuery)) {
        return false;
      }
      if (filters.industry && mentor.industry !== filters.industry) {
        return false;
      }
      if (filters.year && mentor.graduation_year?.toString() !== filters.year) {
        return false;
      }
      return true;
    });
  }, [filters, mentors]);

  const hasActiveFilters =
    filters.nameSearch !== "" || filters.industry !== "" || filters.year !== "";

  const industryOptions: SelectOption[] = [
    { value: "", label: "All industries" },
    ...industries.map((industry) => ({ value: industry, label: industry })),
  ];
  const yearOptions: SelectOption[] = [
    { value: "", label: "All years" },
    ...years.map((year) => ({ value: year.toString(), label: `Class of ${year}` })),
  ];

  const clearFilters = () => {
    setFilters({
      nameSearch: "",
      industry: "",
      year: "",
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Willing to Help</Text>
        <Text style={styles.sectionSubtitle}>
          Browse alumni who have raised their hand to mentor and share their expertise.
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Search mentors</Text>
        <TextInput
          value={filters.nameSearch}
          onChangeText={(nameSearch) =>
            setFilters((current) => ({ ...current, nameSearch }))
          }
          placeholder="Search by name"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.input}
        />
      </View>

      <View style={styles.directoryFilterRow}>
        <View style={styles.directoryFilterField}>
          <SelectField
            label="Industry"
            value={industryOptions.find((option) => option.value === filters.industry)?.label || ""}
            placeholder="All industries"
            onPress={() => setActiveSelect("industry")}
          />
        </View>
        <View style={styles.directoryFilterField}>
          <SelectField
            label="Graduation year"
            value={yearOptions.find((option) => option.value === filters.year)?.label || ""}
            placeholder="All years"
            onPress={() => setActiveSelect("year")}
          />
        </View>
      </View>

      {hasActiveFilters ? (
        <Pressable
          onPress={clearFilters}
          style={({ pressed }) => [
            styles.inlineLinkButton,
            pressed && styles.inlineLinkButtonPressed,
          ]}
        >
          <Text style={styles.inlineLinkText}>Clear filters</Text>
        </Pressable>
      ) : null}

      {showRegistration && !showProfileForm ? (
        <View style={styles.directoryCallout}>
          <View style={styles.directoryCalloutBody}>
            <Text style={styles.calloutTitle}>
              {currentUserProfile ? "Update your mentor profile" : "Want to give back?"}
            </Text>
            <Text style={styles.calloutSubtitle}>
              {currentUserProfile
                ? "Keep your mentor profile current so members can find you."
                : "Join the directory and help current members with your expertise."}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowProfileForm(true)}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.calloutButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {currentUserProfile ? "Edit profile" : "Become a mentor"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showRegistration && showProfileForm ? (
        <MentorProfileForm
          orgId={orgId || ""}
          currentUserProfile={currentUserProfile}
          suggestedDefaults={suggestedDefaults}
          onCancel={() => setShowProfileForm(false)}
          onSaved={() => {
            setShowProfileForm(false);
            onRefresh();
          }}
        />
      ) : null}

      {filteredMentors.length === 0 ? (
        <View style={styles.directoryEmptyState}>
          <Text style={styles.emptyTitle}>
            {hasActiveFilters ? "No mentors found" : "No mentors yet"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {hasActiveFilters
              ? "Try adjusting your filters to see more results."
              : showRegistration
                ? "Be the first mentor in the directory for this organization."
                : "Check back later as alumni register to help."}
          </Text>
        </View>
      ) : (
        <View style={styles.directoryList}>
          {filteredMentors.map((mentor) => {
            const isPending = pendingMentorIds?.has(mentor.user_id) ?? false;
            const isUnavailable = !mentor.accepting_new;
            const isFull = mentor.current_mentee_count >= mentor.max_mentees;
            const requestDisabled = isPending || isUnavailable || isFull;
            const requestLabel = isPending
              ? "Pending"
              : isUnavailable
                ? "Unavailable"
                : isFull
                  ? "Full"
                  : "Request mentorship";

            return (
              <View key={mentor.id} style={styles.directoryCard}>
                <View style={styles.directoryCardHeader}>
                  {mentor.photo_url ? (
                    <Image
                      source={mentor.photo_url}
                      style={styles.directoryAvatar}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <View style={styles.directoryAvatarFallback}>
                      <Text style={styles.directoryAvatarFallbackText}>
                        {mentor.name[0] ?? "M"}
                      </Text>
                    </View>
                  )}
                  <View style={styles.directoryHeaderText}>
                    <Text style={styles.directoryName}>{mentor.name}</Text>
                    <Text style={styles.directoryMeta}>
                      {[mentor.current_company, mentor.current_city]
                        .filter(Boolean)
                        .join(" · ") || "Mentor"}
                    </Text>
                    <Text style={styles.directoryMeta}>
                      {mentor.current_mentee_count} / {mentor.max_mentees} mentees
                      {mentor.years_of_experience != null
                        ? ` · ${mentor.years_of_experience} yrs exp`
                        : ""}
                    </Text>
                  </View>
                </View>

                <View style={styles.directoryBadgeRow}>
                  {mentor.industry ? (
                    <View style={styles.directoryBadge}>
                      <Text style={styles.directoryBadgeText}>{mentor.industry}</Text>
                    </View>
                  ) : null}
                  {mentor.graduation_year ? (
                    <View style={styles.directoryBadge}>
                      <Text style={styles.directoryBadgeText}>
                        Class of {mentor.graduation_year}
                      </Text>
                    </View>
                  ) : null}
                  {!mentor.accepting_new ? (
                    <View style={styles.directoryBadgeWarning}>
                      <Text style={styles.directoryBadgeWarningText}>
                        Not taking new mentees
                      </Text>
                    </View>
                  ) : null}
                </View>

                {mentor.bio ? (
                  <Text style={styles.directoryBio}>{mentor.bio}</Text>
                ) : null}

                {mentor.expertise_areas?.length ? (
                  <Text style={styles.directoryExpertise}>
                    Expertise: {mentor.expertise_areas.join(", ")}
                  </Text>
                ) : null}
                {mentor.topics?.length ? (
                  <Text style={styles.directoryExpertise}>
                    Topics: {mentor.topics.join(", ")}
                  </Text>
                ) : null}
                {mentor.sports?.length ? (
                  <Text style={styles.directoryExpertise}>
                    Sports: {mentor.sports.join(", ")}
                  </Text>
                ) : null}
                {mentor.positions?.length ? (
                  <Text style={styles.directoryExpertise}>
                    Positions: {mentor.positions.join(", ")}
                  </Text>
                ) : null}
                {mentor.meeting_preferences?.length ? (
                  <Text style={styles.directoryExpertise}>
                    Meeting preferences:{" "}
                    {mentor.meeting_preferences.map((value) => value.replace("_", " ")).join(", ")}
                  </Text>
                ) : null}

                <View style={styles.directoryContactRow}>
                  {canRequest ? (
                    <Pressable
                      onPress={() => setRequestMentor(mentor)}
                      disabled={requestDisabled}
                      style={({ pressed }) => [
                        styles.requestButton,
                        pressed && styles.contactButtonPressed,
                        requestDisabled && styles.requestButtonDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.requestButtonText,
                          requestDisabled && styles.requestButtonTextDisabled,
                        ]}
                      >
                        {requestLabel}
                      </Text>
                    </Pressable>
                  ) : null}
                  {mentor.contact_email ? (
                    <Pressable
                      onPress={() => void Linking.openURL(`mailto:${mentor.contact_email}`)}
                      style={({ pressed }) => [
                        styles.contactButton,
                        pressed && styles.contactButtonPressed,
                      ]}
                    >
                      <Text style={styles.contactButtonText}>Email</Text>
                    </Pressable>
                  ) : null}
                  {mentor.contact_linkedin ? (
                    <Pressable
                      onPress={() =>
                        void Linking.openURL(
                          mentor.contact_linkedin?.startsWith("http")
                            ? mentor.contact_linkedin
                            : `https://${mentor.contact_linkedin}`
                        )
                      }
                      style={({ pressed }) => [
                        styles.contactButton,
                        pressed && styles.contactButtonPressed,
                      ]}
                    >
                      <Text style={styles.contactButtonText}>LinkedIn</Text>
                    </Pressable>
                  ) : null}
                  {mentor.contact_phone ? (
                    <Pressable
                      onPress={() => void Linking.openURL(`tel:${mentor.contact_phone}`)}
                      style={({ pressed }) => [
                        styles.contactButton,
                        pressed && styles.contactButtonPressed,
                      ]}
                    >
                      <Text style={styles.contactButtonText}>Call</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <SelectModal
        visible={activeSelect === "industry"}
        title="Choose industry"
        options={industryOptions}
        selectedValue={filters.industry}
        onSelect={(option) => {
          setFilters((current) => ({ ...current, industry: option.value }));
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
      />
      <SelectModal
        visible={activeSelect === "year"}
        title="Choose graduation year"
        options={yearOptions}
        selectedValue={filters.year}
        onSelect={(option) => {
          setFilters((current) => ({ ...current, year: option.value }));
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
      />

      {orgId ? (
        <MentorRequestSheet
          visible={Boolean(requestMentor)}
          mentor={requestMentor}
          orgId={orgId}
          onClose={() => setRequestMentor(null)}
          onRequested={() => {
            setRequestMentor(null);
            onRefresh();
          }}
        />
      ) : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    sectionHeader: {
      gap: SPACING.xs,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: n.secondary,
    },
    placeholderColor: {
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 16,
      color: n.foreground,
      backgroundColor: n.background,
    },
    directoryFilterRow: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    directoryFilterField: {
      flex: 1,
    },
    inlineLinkButton: {
      alignSelf: "flex-start",
      paddingVertical: SPACING.xs,
    },
    inlineLinkButtonPressed: {
      opacity: 0.8,
    },
    inlineLinkText: {
      fontSize: 14,
      color: s.success,
      fontWeight: "500",
    },
    directoryCallout: {
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: n.border,
      backgroundColor: n.divider,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    directoryCalloutBody: {
      gap: SPACING.xs,
    },
    calloutTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    calloutSubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      color: n.surface,
      fontSize: 16,
      fontWeight: "600",
    },
    calloutButton: {
      alignSelf: "flex-start",
      paddingHorizontal: SPACING.md,
    },
    directoryEmptyState: {
      alignItems: "flex-start",
      gap: SPACING.xs,
      paddingTop: SPACING.xs,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    directoryList: {
      gap: SPACING.md,
    },
    directoryCard: {
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    directoryCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    directoryAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    directoryAvatarFallback: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: n.divider,
      borderWidth: 1,
      borderColor: n.border,
    },
    directoryAvatarFallbackText: {
      fontSize: 16,
      fontWeight: "700",
      color: n.foreground,
    },
    directoryHeaderText: {
      flex: 1,
      gap: 2,
    },
    directoryName: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    directoryMeta: {
      fontSize: 14,
      color: n.muted,
    },
    directoryBadgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    directoryBadge: {
      borderRadius: 999,
      backgroundColor: n.divider,
      borderWidth: 1,
      borderColor: n.border,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
    },
    directoryBadgeWarning: {
      borderRadius: 999,
      backgroundColor: `${s.warning}18`,
      borderWidth: 1,
      borderColor: `${s.warning}30`,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
    },
    directoryBadgeText: {
      fontSize: 12,
      color: n.foreground,
      fontWeight: "500",
    },
    directoryBadgeWarningText: {
      fontSize: 12,
      color: s.warning,
      fontWeight: "600",
    },
    directoryBio: {
      fontSize: 14,
      color: n.foreground,
      lineHeight: 20,
    },
    directoryExpertise: {
      fontSize: 14,
      color: n.muted,
      lineHeight: 20,
    },
    directoryContactRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.sm,
    },
    contactButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.background,
    },
    contactButtonPressed: {
      opacity: 0.85,
    },
    contactButtonText: {
      fontSize: 14,
      fontWeight: "500",
      color: n.foreground,
    },
    requestButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
    },
    requestButtonDisabled: {
      backgroundColor: n.divider,
    },
    requestButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#ffffff",
    },
    requestButtonTextDisabled: {
      color: n.foreground,
    },
  });
