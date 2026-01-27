import { useMemo, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter, useNavigation } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

function mergeDateAndTime(date: Date, time: Date) {
  const value = new Date(date);
  value.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return value;
}

function formatDateLabel(value: Date | null) {
  if (!value) return "Select date";
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(value: Date | null) {
  if (!value) return "Select time";
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NewPhilanthropyEventScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug } = useOrg();
  const { isAdmin, isActiveMember, isLoading: roleLoading } = useOrgRole();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [location, setLocation] = useState("");
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAdmin || isActiveMember;

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/${orgSlug}/philanthropy`);
    }
  }, [navigation, router, orgSlug]);

  const pickerMode = useMemo(() => {
    if (!activePicker) return "date";
    return activePicker.includes("date") ? "date" : "time";
  }, [activePicker]);

  const pickerValue = useMemo(() => {
    switch (activePicker) {
      case "start-date":
        return startDate ?? new Date();
      case "start-time":
        return startTime ?? startDate ?? new Date();
      case "end-date":
        return endDate ?? startDate ?? new Date();
      case "end-time":
        return endTime ?? endDate ?? startDate ?? new Date();
      default:
        return new Date();
    }
  }, [activePicker, startDate, startTime, endDate, endTime]);

  const handlePickerChange = (_event: unknown, selected?: Date) => {
    if (!selected || !activePicker) {
      if (Platform.OS !== "ios") {
        setActivePicker(null);
      }
      return;
    }

    switch (activePicker) {
      case "start-date":
        setStartDate(selected);
        if (!startTime) {
          setStartTime(selected);
        }
        break;
      case "start-time":
        setStartTime(selected);
        if (!startDate) {
          setStartDate(selected);
        }
        break;
      case "end-date":
        setEndDate(selected);
        if (!endTime) {
          setEndTime(selected);
        }
        break;
      case "end-time":
        setEndTime(selected);
        if (!endDate) {
          setEndDate(selected);
        }
        break;
    }

    if (Platform.OS !== "ios") {
      setActivePicker(null);
    }
  };

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }
    if (!title.trim()) {
      setError("Event title is required.");
      return;
    }
    if (!startDate || !startTime) {
      setError("Start date and time are required.");
      return;
    }

    const startDateTime = mergeDateAndTime(startDate, startTime);
    let endDateTime: Date | null = null;

    if (endDate || endTime) {
      if (!endDate || !endTime) {
        setError("End date and time must both be provided.");
        return;
      }
      endDateTime = mergeDateAndTime(endDate, endTime);
      if (endDateTime.getTime() < startDateTime.getTime()) {
        setError("End time must be after the start time.");
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("events").insert({
      organization_id: orgId,
      title: title.trim(),
      description: description.trim() || null,
      start_date: startDateTime.toISOString(),
      end_date: endDateTime ? endDateTime.toISOString() : null,
      location: location.trim() || null,
      event_type: "philanthropy",
      is_philanthropy: true,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.push(`/(app)/${orgSlug}/philanthropy`);
  };

  if (roleLoading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>New Event</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator color={SEMANTIC.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!canEdit) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>New Event</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>You do not have access to add philanthropy events.</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>New Event</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New Philanthropy Event</Text>
            <Text style={styles.formSubtitle}>Add a volunteer or community service event</Text>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Event title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Charity 5K Run, Food Bank Volunteering"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the philanthropy event, what volunteers will be doing, any requirements..."
              placeholderTextColor={NEUTRAL.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Start</Text>
            <View style={styles.inlineRow}>
              <Pressable
                onPress={() => setActivePicker("start-date")}
                style={({ pressed }) => [
                  styles.selectField,
                  pressed && styles.selectFieldPressed,
                ]}
              >
                <Text style={styles.selectFieldText}>{formatDateLabel(startDate)}</Text>
              </Pressable>
              <Pressable
                onPress={() => setActivePicker("start-time")}
                style={({ pressed }) => [
                  styles.selectField,
                  pressed && styles.selectFieldPressed,
                ]}
              >
                <Text style={styles.selectFieldText}>{formatTimeLabel(startTime)}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>End (optional)</Text>
            <View style={styles.inlineRow}>
              <Pressable
                onPress={() => setActivePicker("end-date")}
                style={({ pressed }) => [
                  styles.selectField,
                  pressed && styles.selectFieldPressed,
                ]}
              >
                <Text style={styles.selectFieldText}>{formatDateLabel(endDate)}</Text>
              </Pressable>
              <Pressable
                onPress={() => setActivePicker("end-time")}
                style={({ pressed }) => [
                  styles.selectField,
                  pressed && styles.selectFieldPressed,
                ]}
              >
                <Text style={styles.selectFieldText}>{formatTimeLabel(endTime)}</Text>
              </Pressable>
            </View>
          </View>

          {activePicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={pickerValue}
                mode={pickerMode}
                display={
                  Platform.OS === "ios"
                    ? pickerMode === "date"
                      ? "inline"
                      : "spinner"
                    : "default"
                }
                onChange={handlePickerChange}
              />
              {Platform.OS === "ios" ? (
                <Pressable
                  onPress={() => setActivePicker(null)}
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

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="e.g., Philadelphia Food Bank, Schuylkill River Trail"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isSaving && styles.buttonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Create Event</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {
    // Gradient fills this area
  },
  headerSafeArea: {
    // SafeAreaView handles top inset
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -SPACING.sm,
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  formHeader: {
    gap: SPACING.xs,
  },
  formTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
  },
  formSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
  },
  errorCard: {
    backgroundColor: SEMANTIC.errorLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: SEMANTIC.error,
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
  },
  fieldGroup: {
    gap: SPACING.xs,
  },
  fieldLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  input: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    backgroundColor: NEUTRAL.surface,
  },
  textArea: {
    minHeight: 140,
  },
  inlineRow: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  selectField: {
    flex: 1,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: NEUTRAL.surface,
  },
  selectFieldPressed: {
    opacity: 0.9,
  },
  selectFieldText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: NEUTRAL.surface,
  },
  ghostButton: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL.border,
  },
  ghostButtonPressed: {
    opacity: 0.85,
  },
  ghostButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: SEMANTIC.success,
  },
  primaryButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
