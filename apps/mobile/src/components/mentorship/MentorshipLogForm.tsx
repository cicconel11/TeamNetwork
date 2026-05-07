import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ChevronDown } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { formatDefaultDate } from "@/lib/date-format";

export function MentorshipLogForm({
  orgId,
  pairId,
  userId,
  onSaved,
}: {
  orgId: string;
  pairId: string;
  userId: string;
  onSaved: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [progressMetric, setProgressMetric] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!userId) {
      setError("You must be signed in to log progress.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const metricValue = progressMetric.trim()
      ? Number.parseInt(progressMetric, 10)
      : null;
    const sanitizedMetric = Number.isNaN(metricValue) ? null : metricValue;

    const { error: insertError } = await supabase.from("mentorship_logs").insert({
      organization_id: orgId,
      pair_id: pairId,
      created_by: userId,
      entry_date: entryDate.toISOString().slice(0, 10),
      notes: notes.trim() || null,
      progress_metric: sanitizedMetric,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setNotes("");
    setProgressMetric("");
    setIsSaving(false);
    onSaved();
  };

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (selectedDate) {
      setEntryDate(selectedDate);
    }
    if (Platform.OS !== "ios") {
      setShowPicker(false);
    }
  };

  return (
    <View style={styles.logForm}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={({ pressed }) => [
            styles.selectField,
            pressed && styles.selectFieldPressed,
          ]}
        >
          <Text style={styles.selectFieldText}>
            {formatDefaultDate(entryDate)}
          </Text>
          <ChevronDown size={16} color={styles.chevronColor.color} />
        </Pressable>
        {showPicker ? (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={entryDate}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handleDateChange}
            />
            {Platform.OS === "ios" ? (
              <Pressable
                onPress={() => setShowPicker(false)}
                style={({ pressed }) => [
                  styles.ghostButton,
                  pressed && styles.ghostButtonPressed,
                ]}
              >
                <Text style={styles.ghostButtonText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="What did you work on?"
          placeholderTextColor={styles.placeholderColor.color}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Progress metric (optional)</Text>
        <TextInput
          value={progressMetric}
          onChangeText={setProgressMetric}
          placeholder="e.g., 3 sessions"
          placeholderTextColor={styles.placeholderColor.color}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={styles.primaryButtonText.color} />
        ) : (
          <Text style={styles.primaryButtonText}>Save log</Text>
        )}
      </Pressable>
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    logForm: {
      gap: SPACING.sm,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: n.secondary,
    },
    selectField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.background,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      fontSize: 16,
      color: n.foreground,
    },
    chevronColor: {
      color: n.placeholder,
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
    textArea: {
      minHeight: 90,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      overflow: "hidden",
      backgroundColor: n.surface,
    },
    ghostButton: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: n.foreground,
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
    buttonDisabled: {
      opacity: 0.6,
    },
  });
