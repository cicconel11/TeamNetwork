import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { requestMentor } from "@/lib/mentorship-api";
import type { MentorDirectoryEntry } from "@/types/mentorship";

const ERROR_HINT: Record<string, string> = {
  self_request_blocked: "You cannot request yourself as a mentor.",
  already_requested: "You already have an active request with this mentor.",
  same_sport_required:
    "Your preferences require a mentor sharing your sport. Update preferences or pick a different mentor.",
  same_position_required:
    "Your preferences require the same position. Update preferences or pick a different mentor.",
  same_industry_required:
    "Your preferences require the same industry. Update preferences or pick a different mentor.",
  same_role_family_required:
    "Your preferences require the same job field. Update preferences or pick a different mentor.",
};

export function MentorRequestSheet({
  visible,
  mentor,
  orgId,
  onClose,
  onRequested,
}: {
  visible: boolean;
  mentor: MentorDirectoryEntry | null;
  orgId: string;
  onClose: () => void;
  onRequested: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!mentor) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await requestMentor(orgId, mentor.user_id);
      setSuccess(true);
      // Brief delay so the user sees the success state.
      setTimeout(() => {
        onRequested();
        if (result.reused) {
          // Already existed; close immediately.
          onClose();
        }
      }, 300);
    } catch (err) {
      const message = (err as Error).message || "Failed to send request.";
      const code = (err as { errorCode?: string }).errorCode;
      setError(code && ERROR_HINT[code] ? ERROR_HINT[code] : message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>Request mentorship</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={submitting}
            >
              <X size={20} color={styles.closeColor.color} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {mentor ? (
              <>
                <View style={styles.mentorRow}>
                  {mentor.photo_url ? (
                    <Image
                      source={mentor.photo_url}
                      style={styles.avatar}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>
                        {mentor.name[0] ?? "M"}
                      </Text>
                    </View>
                  )}
                  <View style={styles.mentorMeta}>
                    <Text style={styles.mentorName}>{mentor.name}</Text>
                    <Text style={styles.mentorSubtext}>
                      {[mentor.current_company, mentor.current_city]
                        .filter(Boolean)
                        .join(" · ") || "Mentor"}
                    </Text>
                    <Text style={styles.mentorSubtext}>
                      {[
                        mentor.industry,
                        mentor.graduation_year ? `Class of ${mentor.graduation_year}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </View>

                {mentor.bio ? (
                  <Text style={styles.bio}>{mentor.bio}</Text>
                ) : null}

                {mentor.expertise_areas?.length ? (
                  <View style={styles.tagRow}>
                    {mentor.expertise_areas.map((area) => (
                      <View key={area} style={styles.tag}>
                        <Text style={styles.tagText}>{area}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.body}>
                  When you request mentorship, this mentor will receive a notification.
                  An admin reviews proposals before they become active pairs.
                </Text>

                {error ? (
                  <View style={styles.errorCard}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {success ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successText}>
                      Request sent. We&apos;ll let you know when it&apos;s reviewed.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={handleClose}
              disabled={submitting}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting || success || !mentor}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                (submitting || success || !mentor) && styles.buttonDisabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {success ? "Sent" : "Send request"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: n.surface,
      borderTopLeftRadius: RADIUS.lg,
      borderTopRightRadius: RADIUS.lg,
      maxHeight: "85%",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    title: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    closeColor: {
      color: n.muted,
    },
    content: {
      padding: SPACING.md,
      gap: SPACING.md,
    },
    mentorRow: {
      flexDirection: "row",
      gap: SPACING.md,
      alignItems: "center",
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
    },
    avatarFallback: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: n.divider,
      borderWidth: 1,
      borderColor: n.border,
    },
    avatarFallbackText: {
      fontSize: 18,
      fontWeight: "700",
      color: n.foreground,
    },
    mentorMeta: {
      flex: 1,
      gap: 2,
    },
    mentorName: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    mentorSubtext: {
      fontSize: 13,
      color: n.muted,
    },
    bio: {
      fontSize: 14,
      lineHeight: 20,
      color: n.foreground,
    },
    tagRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    tag: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: n.divider,
      borderWidth: 1,
      borderColor: n.border,
    },
    tagText: {
      fontSize: 12,
      color: n.foreground,
      fontWeight: "500",
    },
    body: {
      fontSize: 14,
      color: n.muted,
      lineHeight: 20,
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
    successCard: {
      backgroundColor: `${s.success}14`,
      borderWidth: 1,
      borderColor: `${s.success}55`,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
    },
    successText: {
      fontSize: 13,
      color: s.success,
    },
    footer: {
      flexDirection: "row",
      gap: SPACING.sm,
      padding: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: n.border,
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
