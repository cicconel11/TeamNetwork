import React, { useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { AlertTriangle, ChevronDown } from "lucide-react-native";
import { useRouter } from "expo-router";
import { fetchWithAuth } from "@/lib/web-api";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, formatDate, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  orgId: string;
  orgName: string | null;
  isAdmin: boolean;
  subscription: { status: string; currentPeriodEnd: string | null } | null;
  refetchSubscription: () => void;
}

export function SettingsDangerSection({ orgId, orgName, isAdmin, subscription, refetchSubscription }: Props) {
  const router = useRouter();
  const { neutral, semantic } = useAppColorScheme();
  const colors = buildSettingsColors(neutral, semantic);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const styles = useThemedStyles((n, s) => ({
    dangerCard: {
      borderWidth: 1,
      borderColor: s.warning + "50",
      backgroundColor: s.warning + "08",
    },
    dangerItem: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "space-between" as const,
      gap: 12,
    },
    dangerInfo: {
      flex: 1,
    },
    dangerTitle: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      marginBottom: 4,
    },
    dangerDescription: {
      fontSize: 13,
      color: n.placeholder,
    },
    dangerButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: s.warning,
    },
    dangerButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: s.warning,
    },
    deleteButton: {
      backgroundColor: s.error,
      borderColor: s.error,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 24,
    },
    modalContent: {
      backgroundColor: n.surface,
      borderRadius: 16,
      padding: 24,
      width: "100%" as const,
      maxWidth: 400,
    },
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: n.foreground,
      marginBottom: 12,
    },
    modalDescription: {
      fontSize: 15,
      color: n.placeholder,
      marginBottom: 20,
    },
    modalBold: {
      fontWeight: fontWeight.semibold,
      color: n.foreground,
    },
    modalInput: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: n.foreground,
      marginBottom: 20,
    },
    modalActions: {
      flexDirection: "row" as const,
      gap: 12,
    },
    modalCancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    modalCancelText: {
      fontSize: fontSize.base,
      color: n.muted,
    },
    modalDeleteButton: {
      flex: 1,
      backgroundColor: s.error,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center" as const,
    },
    modalDeleteText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#fff",
    },
  }));

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
    if (!orgId || !orgName) return;

    if (deleteConfirmText !== orgName) {
      Alert.alert("Error", `Please type "${orgName}" to confirm deletion.`);
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

  return (
    <>
      <View style={baseStyles.section}>
        <Pressable
          style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <View style={baseStyles.sectionHeaderLeft}>
            <AlertTriangle size={20} color={colors.warning} />
            <Text style={baseStyles.sectionTitle}>Danger Zone</Text>
          </View>
          <ChevronDown
            size={20}
            color={colors.mutedForeground}
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        </Pressable>

        {expanded && (
          <View style={[baseStyles.card, styles.dangerCard]}>
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

            <View style={baseStyles.divider} />

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
              Type <Text style={styles.modalBold}>{orgName}</Text> to confirm deletion.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={`Type "${orgName}" to confirm`}
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
                  (deleting || deleteConfirmText !== orgName) && styles.buttonDisabled,
                ]}
                onPress={confirmDeleteOrganization}
                disabled={deleting || deleteConfirmText !== orgName}
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
