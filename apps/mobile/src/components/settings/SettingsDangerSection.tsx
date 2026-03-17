import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { AlertTriangle, ChevronDown } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSubscription } from "@/hooks/useSubscription";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { fetchWithAuth } from "@/lib/web-api";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { type SettingsColors } from "./settingsColors";

interface Props {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  colors: SettingsColors;
}

function formatDate(dateString: string | null): string {
  return formatMonthDayYearSafe(dateString, "N/A");
}

const fontSize = { xs: 12, sm: 14, base: 16, lg: 18 };
const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export function SettingsDangerSection({ orgId, orgSlug, isAdmin, colors }: Props) {
  const router = useRouter();
  const { subscription, refetch: refetchSubscription } = useSubscription(orgId);
  const { org } = useOrgSettings(orgId);

  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  if (!isAdmin) return null;

  const handleCancelSubscription = async () => {
    if (!orgId) return;

    const periodEnd = subscription?.currentPeriodEnd
      ? formatDate(subscription.currentPeriodEnd)
      : "the end of your billing period";

    Alert.alert(
      "Cancel Subscription",
      `Your subscription will remain active until ${periodEnd}. After that, you'll have 30 days of read-only access.\n\nAre you sure?`,
      [
        { text: "Keep Subscription", style: "cancel" },
        {
          text: "Cancel Subscription",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              const response = await fetchWithAuth(`/api/organizations/${orgId}/cancel-subscription`, {
                method: "POST",
              });
              const data = await response.json();
              if (!response.ok) {
                throw new Error(data.error || "Unable to cancel subscription");
              }
              Alert.alert("Subscription Cancelled", "You can resubscribe anytime to keep your organization.");
              refetchSubscription();
            } catch (e) {
              Alert.alert("Error", (e as Error).message);
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteOrganization = () => {
    Alert.alert(
      "Delete Organization",
      "WARNING: This will permanently delete all data including members, events, and files. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => setShowDeleteConfirm(true),
        },
      ]
    );
  };

  const confirmDeleteOrganization = async () => {
    if (!orgId || !org) return;

    if (deleteConfirmText !== org.name && deleteConfirmText !== org.slug) {
      Alert.alert("Error", `Please type "${org.name}" to confirm deletion.`);
      return;
    }

    setDeleting(true);
    try {
      const response = await fetchWithAuth(`/api/organizations/${orgId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to delete organization");
      }
      Alert.alert("Deleted", "Your organization has been deleted.");
      router.replace("/(app)");
    } catch (e) {
      Alert.alert("Error", (e as Error).message);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
    }
  };

  const styles = createStyles(colors);

  return (
    <>
      <View style={styles.section}>
        <Pressable
          style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <View style={styles.sectionHeaderLeft}>
            <AlertTriangle size={20} color={colors.warning} />
            <Text style={styles.sectionTitle}>Danger Zone</Text>
          </View>
          <ChevronDown
            size={20}
            color={colors.mutedForeground}
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        </Pressable>

        {expanded && (
          <View style={[styles.card, styles.dangerCard]}>
            <View style={styles.dangerItem}>
              <View style={styles.dangerInfo}>
                <Text style={styles.dangerTitle}>Cancel Subscription</Text>
                <Text style={styles.dangerDescription}>
                  Your subscription will remain active until the end of your billing period.
                </Text>
              </View>
              <Pressable
                style={styles.dangerButton}
                onPress={handleCancelSubscription}
                disabled={
                  cancelling ||
                  subscription?.status === "canceling" ||
                  subscription?.status === "canceled"
                }
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color={colors.warning} />
                ) : (
                  <Text style={styles.dangerButtonText}>
                    {subscription?.status === "canceling" ? "Cancelling..." : "Cancel"}
                  </Text>
                )}
              </Pressable>
            </View>

            <View style={styles.divider} />

            <View style={styles.dangerItem}>
              <View style={styles.dangerInfo}>
                <Text style={styles.dangerTitle}>Delete Organization</Text>
                <Text style={styles.dangerDescription}>
                  Permanently delete this organization and all its data. This cannot be undone.
                </Text>
              </View>
              <Pressable
                style={[styles.dangerButton, styles.deleteButton]}
                onPress={handleDeleteOrganization}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete Organization?</Text>
            <Text style={styles.modalDescription}>
              Type <Text style={styles.modalBold}>{org?.name}</Text> to confirm deletion.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={`Type "${org?.name}" to confirm`}
              placeholderTextColor={colors.mutedForeground}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalDeleteButton,
                  (deleting || deleteConfirmText !== org?.name) && styles.buttonDisabled,
                ]}
                onPress={confirmDeleteOrganization}
                disabled={deleting || deleteConfirmText !== org?.name}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete Forever</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors: SettingsColors) =>
  StyleSheet.create({
    section: {
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    sectionHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderCurve: "continuous",
    },
    dangerCard: {
      borderWidth: 1,
      borderColor: colors.warning + "50",
      backgroundColor: colors.warning + "08",
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
    },
    dangerItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    dangerInfo: {
      flex: 1,
    },
    dangerTitle: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginBottom: 4,
    },
    dangerDescription: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    dangerButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    dangerButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.warning,
    },
    deleteButton: {
      backgroundColor: colors.error,
      borderColor: colors.error,
    },
    deleteButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: "#fff",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    modalContent: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 24,
      width: "100%",
      maxWidth: 400,
    },
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 12,
    },
    modalDescription: {
      fontSize: 15,
      color: colors.mutedForeground,
      marginBottom: 20,
    },
    modalBold: {
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    modalInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: colors.foreground,
      marginBottom: 20,
    },
    modalActions: {
      flexDirection: "row",
      gap: 12,
    },
    modalCancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    modalCancelText: {
      fontSize: fontSize.base,
      color: colors.muted,
    },
    modalDeleteButton: {
      flex: 1,
      backgroundColor: colors.error,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    modalDeleteText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#fff",
    },
  });
