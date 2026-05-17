import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Flag, ShieldOff } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { showToast } from "@/components/ui/Toast";
import { reportContent, toggleBlock } from "@/lib/moderation";
import type { ReportReason, ReportTargetType } from "@/lib/moderation";
import * as sentry from "@/lib/analytics/sentry";

const REASONS: { id: ReportReason; label: string; description: string }[] = [
  { id: "spam", label: "Spam", description: "Unwanted commercial or repetitive content" },
  { id: "harassment", label: "Harassment or bullying", description: "Targeted attacks or insults" },
  { id: "hate", label: "Hate speech", description: "Attacks based on identity" },
  { id: "sexual", label: "Sexual content", description: "Explicit or inappropriate sexual material" },
  { id: "violence", label: "Violence or threats", description: "Threats of harm" },
  { id: "self_harm", label: "Self-harm", description: "Encourages or depicts self-injury" },
  { id: "illegal", label: "Illegal activity", description: "Promotes unlawful behavior" },
  { id: "impersonation", label: "Impersonation", description: "Pretending to be someone else" },
  { id: "other", label: "Other", description: "Something else not listed" },
];

export interface ReportBlockSheetProps {
  visible: boolean;
  onClose: () => void;
  orgId: string | null;
  targetType: ReportTargetType;
  targetId: string;
  /** User id of the content author / profile subject. Required for Block. */
  reportedUserId: string | null;
  /** Hide block option (e.g. when blocking is not applicable). */
  hideBlock?: boolean;
  /** Hide report option (rare, e.g. block-only flow). */
  hideReport?: boolean;
  /** Called after a successful block toggle so parent can update UI. */
  onBlocked?: () => void;
}

type Stage = "picker" | "reason";

export function ReportBlockSheet({
  visible,
  onClose,
  orgId,
  targetType,
  targetId,
  reportedUserId,
  hideBlock,
  hideReport,
  onBlocked,
}: ReportBlockSheetProps) {
  const { neutral, semantic } = useAppColorScheme();
  const [stage, setStage] = useState<Stage>("picker");
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const styles = useThemedStyles((n, s) => ({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end" as const,
    },
    sheet: {
      backgroundColor: n.surface,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.lg,
      paddingBottom: SPACING.xl,
      maxHeight: "85%" as const,
    },
    handle: {
      alignSelf: "center" as const,
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: n.border,
      marginBottom: SPACING.md,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    subtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginBottom: SPACING.lg,
    },
    actionRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
      gap: SPACING.sm,
    },
    actionRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    actionLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "500" as const,
      flex: 1,
    },
    actionLabelDestructive: {
      color: s.error,
    },
    reasonRow: {
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.sm,
    },
    reasonRowSelected: {
      backgroundColor: n.muted + "1a",
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: n.border,
      marginTop: 2,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    radioSelected: {
      borderColor: s.success,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: s.success,
    },
    reasonText: {
      flex: 1,
    },
    reasonLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "500" as const,
    },
    reasonDesc: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginTop: 2,
    },
    detailsInput: {
      marginTop: SPACING.md,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      minHeight: 80,
      textAlignVertical: "top" as const,
    },
    detailsCount: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      textAlign: "right" as const,
      marginTop: 4,
    },
    buttonRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      marginTop: SPACING.lg,
    },
    button: {
      flex: 1,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
    },
    buttonSecondary: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
    },
    buttonPrimary: {
      backgroundColor: s.success,
    },
    buttonPrimaryDisabled: {
      opacity: 0.5,
    },
    buttonLabelSecondary: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
    },
    buttonLabelPrimary: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    cancelButton: {
      marginTop: SPACING.sm,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      backgroundColor: n.background,
    },
  }));

  const reset = useCallback(() => {
    setStage("picker");
    setSelectedReason(null);
    setDetails("");
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleReportPress = useCallback(() => {
    setStage("reason");
  }, []);

  const handleBlockPress = useCallback(() => {
    if (!reportedUserId) {
      showToast("Cannot block this account", "error");
      return;
    }
    Alert.alert(
      "Block this user?",
      "You won't see their messages, posts, or comments. They won't see yours either.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              setSubmitting(true);
              await toggleBlock(reportedUserId);
              showToast("Blocked", "success");
              onBlocked?.();
              handleClose();
            } catch (e) {
              const message = (e as Error).message || "Failed to block";
              showToast(message, "error");
              sentry.captureException(e as Error, {
                context: "ReportBlockSheet.block",
                reportedUserId,
              });
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [reportedUserId, onBlocked, handleClose]);

  const handleSubmitReport = useCallback(async () => {
    if (!selectedReason || !orgId) return;
    try {
      setSubmitting(true);
      await reportContent({
        orgId,
        targetType,
        targetId,
        reportedUserId,
        reason: selectedReason,
        details: details.trim() || undefined,
      });
      showToast("Reported. Thanks for letting us know.", "success");
      handleClose();
    } catch (e) {
      const message = (e as Error).message || "Failed to report";
      showToast(message, "error");
      sentry.captureException(e as Error, {
        context: "ReportBlockSheet.report",
        targetType,
        targetId,
      });
      setSubmitting(false);
    }
  }, [selectedReason, orgId, targetType, targetId, reportedUserId, details, handleClose]);

  const showBlock = !hideBlock && !!reportedUserId;
  const showReport = !hideReport;

  const detailsRemaining = useMemo(() => 1000 - details.length, [details]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          {stage === "picker" && (
            <>
              <Text style={styles.title}>What would you like to do?</Text>
              <Text style={styles.subtitle}>
                Reports are reviewed within 24 hours.
              </Text>

              {showReport && (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionRow,
                    showBlock && styles.actionRowBorder,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={handleReportPress}
                  accessibilityRole="button"
                  accessibilityLabel="Report"
                >
                  <Flag size={20} color={neutral.foreground} />
                  <Text style={styles.actionLabel}>Report</Text>
                </Pressable>
              )}

              {showBlock && (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionRow,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={handleBlockPress}
                  accessibilityRole="button"
                  accessibilityLabel="Block user"
                  disabled={submitting}
                >
                  <ShieldOff size={20} color={semantic.error} />
                  <Text
                    style={[
                      styles.actionLabel,
                      styles.actionLabelDestructive,
                    ]}
                  >
                    Block user
                  </Text>
                </Pressable>
              )}

              <Pressable
                style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
                onPress={handleClose}
              >
                <Text style={styles.buttonLabelSecondary}>Cancel</Text>
              </Pressable>
            </>
          )}

          {stage === "reason" && (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Why are you reporting this?</Text>
              <Text style={styles.subtitle}>
                Pick the reason that fits best.
              </Text>

              {REASONS.map((r) => {
                const selected = selectedReason === r.id;
                return (
                  <Pressable
                    key={r.id}
                    style={({ pressed }) => [
                      styles.reasonRow,
                      selected && styles.reasonRowSelected,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => setSelectedReason(r.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View
                      style={[
                        styles.radio,
                        selected && styles.radioSelected,
                      ]}
                    >
                      {selected && <View style={styles.radioInner} />}
                    </View>
                    <View style={styles.reasonText}>
                      <Text style={styles.reasonLabel}>{r.label}</Text>
                      <Text style={styles.reasonDesc}>{r.description}</Text>
                    </View>
                  </Pressable>
                );
              })}

              <TextInput
                style={styles.detailsInput}
                placeholder="Add details (optional)"
                placeholderTextColor={neutral.muted}
                value={details}
                onChangeText={(t) => setDetails(t.slice(0, 1000))}
                multiline
                maxLength={1000}
                editable={!submitting}
              />
              <Text style={styles.detailsCount}>
                {detailsRemaining} characters left
              </Text>

              <View style={styles.buttonRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonSecondary,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={handleClose}
                  disabled={submitting}
                >
                  <Text style={styles.buttonLabelSecondary}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonPrimary,
                    (!selectedReason || submitting) && styles.buttonPrimaryDisabled,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleSubmitReport}
                  disabled={!selectedReason || submitting}
                >
                  <Text style={styles.buttonLabelPrimary}>
                    {submitting ? "Submitting…" : "Submit report"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default ReportBlockSheet;
