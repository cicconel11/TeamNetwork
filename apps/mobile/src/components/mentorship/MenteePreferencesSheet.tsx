import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Switch,
  StyleSheet,
} from "react-native";
import { X } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import {
  EMPTY_MENTEE_PREFERENCES,
  getPreferences,
  savePreferences,
  type MenteePreferences,
} from "@/lib/mentorship-api";
import type { SelectOption } from "@/types/mentorship";

const TIME_OPTIONS: SelectOption[] = [
  { value: "", label: "Select availability…" },
  { value: "1hr/month", label: "1 hour / month" },
  { value: "2hr/month", label: "2 hours / month" },
  { value: "4hr/month", label: "4 hours / month" },
  { value: "flexible", label: "Flexible" },
];

const COMM_OPTIONS: Array<{
  value: "video" | "phone" | "in_person" | "async";
  label: string;
}> = [
  { value: "video", label: "Video call" },
  { value: "phone", label: "Phone call" },
  { value: "in_person", label: "In person" },
  { value: "async", label: "Async messages" },
];

const ATTRIBUTE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "same_sport", label: "Same sport" },
  { value: "same_position", label: "Same position" },
  { value: "same_industry", label: "Same industry" },
  { value: "same_role_family", label: "Same job field" },
  { value: "alumni_of_org", label: "Alumni of this org" },
  { value: "local", label: "Local" },
  { value: "female", label: "Female" },
  { value: "veteran", label: "Veteran" },
  { value: "first_gen", label: "First-gen" },
];

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
function joinCsv(arr: string[]): string {
  return arr.join(", ");
}

export function MenteePreferencesSheet({
  visible,
  orgId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  orgId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<MenteePreferences>(EMPTY_MENTEE_PREFERENCES);
  const [topicsText, setTopicsText] = useState("");
  const [industriesText, setIndustriesText] = useState("");
  const [roleFamiliesText, setRoleFamiliesText] = useState("");
  const [sportsText, setSportsText] = useState("");
  const [positionsText, setPositionsText] = useState("");
  const [activeSelect, setActiveSelect] = useState<"time" | null>(null);

  const hydrate = useCallback((p: MenteePreferences) => {
    setForm(p);
    setTopicsText(joinCsv(p.preferred_topics));
    setIndustriesText(joinCsv(p.preferred_industries));
    setRoleFamiliesText(joinCsv(p.preferred_role_families));
    setSportsText(joinCsv(p.preferred_sports));
    setPositionsText(joinCsv(p.preferred_positions));
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { preferences } = await getPreferences(orgId);
        if (cancelled) return;
        if (preferences) {
          hydrate({
            ...EMPTY_MENTEE_PREFERENCES,
            ...preferences,
            time_availability:
              (preferences.time_availability as MenteePreferences["time_availability"]) ?? "",
            communication_prefs:
              (preferences.communication_prefs as MenteePreferences["communication_prefs"]) ?? [],
            preferred_topics: preferences.preferred_topics ?? [],
            preferred_industries: preferences.preferred_industries ?? [],
            preferred_role_families: preferences.preferred_role_families ?? [],
            preferred_sports: preferences.preferred_sports ?? [],
            preferred_positions: preferences.preferred_positions ?? [],
            required_attributes: preferences.required_attributes ?? [],
            nice_to_have_attributes: preferences.nice_to_have_attributes ?? [],
            goals: preferences.goals ?? "",
            geographic_pref: preferences.geographic_pref ?? "",
            seeking_mentorship: preferences.seeking_mentorship ?? false,
          });
        } else {
          hydrate(EMPTY_MENTEE_PREFERENCES);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load preferences.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, orgId, hydrate]);

  const toggleAttr = (
    list: "required_attributes" | "nice_to_have_attributes",
    key: string
  ) => {
    setForm((prev) => {
      const current = prev[list];
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
      return { ...prev, [list]: next };
    });
  };

  const toggleComm = (key: "video" | "phone" | "in_person" | "async") => {
    setForm((prev) => ({
      ...prev,
      communication_prefs: prev.communication_prefs.includes(key)
        ? prev.communication_prefs.filter((k) => k !== key)
        : [...prev.communication_prefs, key],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: MenteePreferences = {
        ...form,
        preferred_topics: parseCsv(topicsText),
        preferred_industries: parseCsv(industriesText),
        preferred_role_families: parseCsv(roleFamiliesText),
        preferred_sports: parseCsv(sportsText),
        preferred_positions: parseCsv(positionsText),
      };
      await savePreferences(orgId, payload);
      onSaved?.();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.title}>My Mentorship Preferences</Text>
          <Pressable
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={styles.closeColor.color} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={styles.loadingColor.color} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Looking for a mentor</Text>
                <Text style={styles.helper}>
                  Turn this on to be matched in admin rounds.
                </Text>
              </View>
              <Switch
                value={form.seeking_mentorship}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, seeking_mentorship: v }))
                }
              />
            </View>

            <Field label="Goals">
              <TextInput
                value={form.goals}
                onChangeText={(goals) => setForm((prev) => ({ ...prev, goals }))}
                placeholder="What do you want to learn or work on?"
                placeholderTextColor={styles.placeholderColor.color}
                multiline
                style={[styles.input, styles.multiline]}
              />
            </Field>

            <CsvField
              label="Topics"
              hint="Comma-separated. e.g. leadership, networking, MBA"
              value={topicsText}
              onChangeText={setTopicsText}
              placeholderColor={styles.placeholderColor.color}
              styles={styles}
            />
            <CsvField
              label="Industries"
              hint="Comma-separated. e.g. tech, finance"
              value={industriesText}
              onChangeText={setIndustriesText}
              placeholderColor={styles.placeholderColor.color}
              styles={styles}
            />
            <CsvField
              label="Job fields (role families)"
              hint="Comma-separated. e.g. engineering, sales"
              value={roleFamiliesText}
              onChangeText={setRoleFamiliesText}
              placeholderColor={styles.placeholderColor.color}
              styles={styles}
            />
            <CsvField
              label="Sports"
              hint="Comma-separated. e.g. soccer, lacrosse"
              value={sportsText}
              onChangeText={setSportsText}
              placeholderColor={styles.placeholderColor.color}
              styles={styles}
            />
            <CsvField
              label="Positions"
              hint="Comma-separated. e.g. midfielder, attack"
              value={positionsText}
              onChangeText={setPositionsText}
              placeholderColor={styles.placeholderColor.color}
              styles={styles}
            />

            <Field label="Time availability">
              <SelectField
                label=""
                value={
                  TIME_OPTIONS.find((opt) => opt.value === form.time_availability)?.label || ""
                }
                placeholder="Select availability…"
                onPress={() => setActiveSelect("time")}
              />
            </Field>

            <Field label="Communication preferences">
              <View style={styles.chipRow}>
                {COMM_OPTIONS.map((opt) => {
                  const selected = form.communication_prefs.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleComm(opt.value)}
                      style={({ pressed }) => [
                        styles.chip,
                        selected && styles.chipActive,
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label="Required mentor attributes">
              <View style={styles.chipRow}>
                {ATTRIBUTE_OPTIONS.map((opt) => {
                  const selected = form.required_attributes.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleAttr("required_attributes", opt.value)}
                      style={({ pressed }) => [
                        styles.chip,
                        selected && styles.chipActive,
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.helper}>
                Mentors must match every required attribute.
              </Text>
            </Field>

            <Field label="Nice-to-have attributes">
              <View style={styles.chipRow}>
                {ATTRIBUTE_OPTIONS.map((opt) => {
                  const selected = form.nice_to_have_attributes.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleAttr("nice_to_have_attributes", opt.value)}
                      style={({ pressed }) => [
                        styles.chip,
                        selected && styles.chipActive,
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label="Geographic preference">
              <TextInput
                value={form.geographic_pref}
                onChangeText={(geographic_pref) =>
                  setForm((prev) => ({ ...prev, geographic_pref }))
                }
                placeholder="e.g. NYC, remote-friendly"
                placeholderTextColor={styles.placeholderColor.color}
                style={styles.input}
              />
            </Field>

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            disabled={saving}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving || loading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              (saving || loading) && styles.buttonDisabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save preferences</Text>
            )}
          </Pressable>
        </View>

        <SelectModal
          visible={activeSelect === "time"}
          title="Time availability"
          options={TIME_OPTIONS}
          selectedValue={form.time_availability}
          onSelect={(option) => {
            setForm((prev) => ({
              ...prev,
              time_availability: option.value as MenteePreferences["time_availability"],
            }));
            setActiveSelect(null);
          }}
          onClose={() => setActiveSelect(null)}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

function CsvField({
  label,
  hint,
  value,
  onChangeText,
  placeholderColor,
  styles,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholderColor: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={hint}
        placeholderTextColor={placeholderColor}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Text style={styles.helper}>{hint}</Text>
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      backgroundColor: n.surface,
    },
    title: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    closeColor: {
      color: n.muted,
    },
    loadingState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingColor: {
      color: s.success,
    },
    content: {
      padding: SPACING.md,
      gap: SPACING.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      paddingVertical: SPACING.sm,
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      paddingHorizontal: SPACING.md,
    },
    field: {
      gap: SPACING.xs,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: n.foreground,
    },
    helper: {
      fontSize: 12,
      color: n.muted,
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
      fontSize: 15,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    multiline: {
      minHeight: 80,
      textAlignVertical: "top",
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    chip: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs + 2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipActive: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    chipPressed: {
      opacity: 0.85,
    },
    chipText: {
      fontSize: 13,
      fontWeight: "500",
      color: n.foreground,
    },
    chipTextActive: {
      color: "#ffffff",
    },
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
    },
    errorText: {
      fontSize: 13,
      color: s.error,
    },
    footer: {
      flexDirection: "row",
      gap: SPACING.sm,
      padding: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: n.border,
      backgroundColor: n.surface,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 15,
      fontWeight: "600",
    },
    secondaryButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      color: n.foreground,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
