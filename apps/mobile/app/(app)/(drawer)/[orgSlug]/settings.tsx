import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
  TextInput,
  Image,
  Modal,
  Pressable,
  Clipboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useInvites, getInviteLink, isInviteValid, isInviteExpired, isInviteRevoked, isInviteExhausted } from "@/hooks/useInvites";
import { useMemberships, getRoleLabel, getStatusLabel } from "@/hooks/useMemberships";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { StripeWebView } from "@/components/StripeWebView";
import { captureException } from "@/lib/analytics";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { getWebAppUrl, fetchWithAuth } from "@/lib/web-api";
import type { ThemeColors } from "@/lib/theme";
import type { AlumniBucket } from "@teammeet/types";
import {
  ChevronRight,
  ChevronDown,
  CreditCard,
  User,
  Info,
  ExternalLink,
  Bell,
  Building2,
  Palette,
  Users,
  Link as LinkIcon,
  Shield,
  AlertTriangle,
  Trash2,
  Copy,
  QrCode,
  Plus,
  X,
  Check,
} from "lucide-react-native";
import Constants from "expo-constants";
import QRCode from "react-native-qrcode-svg";

const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

const BUCKET_OPTIONS: { value: AlumniBucket; label: string }[] = [
  { value: "0-250", label: "0–250 alumni" },
  { value: "251-500", label: "251–500 alumni" },
  { value: "501-1000", label: "501–1,000 alumni" },
  { value: "1001-2500", label: "1,001–2,500 alumni" },
  { value: "2500-5000", label: "2,500–5,000 alumni" },
  { value: "5000+", label: "5,000+ (contact us)" },
];

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

function formatStatus(status: string, colors: ThemeColors): { label: string; color: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: colors.success };
    case "trialing":
      return { label: "Trial", color: colors.primary };
    case "past_due":
      return { label: "Past Due", color: colors.warning };
    case "canceled":
    case "canceling":
      return { label: status === "canceling" ? "Canceling" : "Canceled", color: colors.error };
    default:
      return { label: status, color: colors.mutedForeground };
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Hooks with realtime sync
  const { org, loading: orgLoading, updateName, updateBranding } = useOrgSettings(orgSlug);
  const { prefs, loading: prefsLoading, saving: prefsSaving, updatePrefs } = useNotificationPreferences(orgId);
  const { invites, loading: invitesLoading, createInvite, revokeInvite, deleteInvite } = useInvites(orgId);
  const { memberships, pendingMembers, pendingAlumni, loading: membersLoading, updateRole, updateAccess, approveMember, rejectMember } = useMemberships(orgId);
  const { subscription, loading: subLoading, error: subError, refetch: refetchSubscription } = useSubscription(orgId);

  // Local state
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Organization editing
  const [editedName, setEditedName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  
  // Notification preferences
  const [emailAddress, setEmailAddress] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  
  // Invite creation
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [inviteUses, setInviteUses] = useState("");
  const [inviteExpires, setInviteExpires] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  
  // Role change confirmation
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [pendingAdminUserId, setPendingAdminUserId] = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  
  // Billing
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>("0-250");
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");
  const [planUpdating, setPlanUpdating] = useState(false);
  const [showBucketPicker, setShowBucketPicker] = useState(false);
  
  // Danger zone
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  
  // Expanded sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    organization: true,
    notifications: true,
    invites: false,
    access: false,
    billing: true,
    danger: false,
  });

  // Fetch user role
  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgId || !user) {
        setRoleLoading(false);
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .single();

        if (roleData && isMounted) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);
        }
      } catch (e) {
        console.error("Failed to fetch role:", e);
        captureException(e as Error, { screen: "Settings", context: "fetchRole", orgId });
      } finally {
        if (isMounted) {
          setRoleLoading(false);
        }
      }
    }

    fetchRole();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  // Sync local state with fetched data
  useEffect(() => {
    if (org) {
      setEditedName(org.name);
    }
  }, [org]);

  useEffect(() => {
    if (prefs) {
      setEmailAddress(prefs.email_address || "");
      setEmailEnabled(prefs.email_enabled);
      setPushEnabled(prefs.push_enabled);
    }
  }, [prefs]);

  useEffect(() => {
    if (subscription?.bucket) {
      setSelectedBucket(subscription.bucket);
    }
  }, [subscription?.bucket]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchSubscription();
    setRefreshing(false);
  }, [refetchSubscription]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Organization name save
  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === org?.name) return;
    setNameSaving(true);
    setNameError(null);
    const result = await updateName(editedName);
    if (!result.success) {
      setNameError(result.error || "Failed to update name");
    }
    setNameSaving(false);
  };

  // Notification preferences save
  const handleSaveNotifications = async () => {
    await updatePrefs({
      email_address: emailAddress.trim() || null,
      email_enabled: emailEnabled,
      push_enabled: pushEnabled,
    });
  };

  // Create invite
  const handleCreateInvite = async () => {
    if (inviteRole === "alumni" && subscription && subscription.alumniLimit !== null && subscription.alumniCount >= subscription.alumniLimit) {
      Alert.alert("Alumni Limit Reached", "Upgrade your plan to invite more alumni.");
      return;
    }

    setInviteCreating(true);
    const result = await createInvite({
      role: inviteRole,
      usesRemaining: inviteUses ? parseInt(inviteUses) : null,
      expiresAt: inviteExpires ? new Date(inviteExpires).toISOString() : null,
    });

    if (result.success) {
      setShowInviteForm(false);
      setInviteRole("active_member");
      setInviteUses("");
      setInviteExpires("");
    } else {
      Alert.alert("Error", result.error || "Failed to create invite");
    }
    setInviteCreating(false);
  };

  // Copy invite link
  const copyInviteLink = (invite: { id: string; code: string; token: string | null }) => {
    const link = getInviteLink(invite, getWebAppUrl());
    Clipboard.setString(link);
    setCopiedInviteId(invite.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  // Role change
  const handleRoleChange = async (userId: string, newRole: "admin" | "active_member" | "alumni") => {
    const member = memberships.find((m) => m.user_id === userId);
    if (member?.role === newRole) return;

    if (newRole === "admin") {
      setPendingAdminUserId(userId);
      setShowAdminConfirm(true);
      return;
    }

    setRoleChanging(userId);
    const result = await updateRole(userId, newRole);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to update role");
    }
    setRoleChanging(null);
  };

  const confirmAdminPromotion = async () => {
    if (!pendingAdminUserId) return;
    setRoleChanging(pendingAdminUserId);
    const result = await updateRole(pendingAdminUserId, "admin");
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to promote to admin");
    }
    setRoleChanging(null);
    setShowAdminConfirm(false);
    setPendingAdminUserId(null);
  };

  // Access control
  const handleRemoveAccess = async (userId: string) => {
    Alert.alert(
      "Remove Access",
      "Are you sure you want to remove this member's access?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await updateAccess(userId, "revoked");
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to remove access");
            }
          },
        },
      ]
    );
  };

  const handleRestoreAccess = async (userId: string) => {
    const result = await updateAccess(userId, "active");
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to restore access");
    }
  };

  // Approve/reject member
  const handleApproveMember = async (userId: string) => {
    const result = await approveMember(userId);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to approve member");
    }
  };

  const handleRejectMember = async (userId: string) => {
    Alert.alert(
      "Reject Request",
      "Are you sure you want to reject this membership request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            const result = await rejectMember(userId);
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to reject request");
            }
          },
        },
      ]
    );
  };

  // Billing portal
  const handleManageBilling = async () => {
    if (!orgId) return;

    setBillingLoading(true);
    try {
      const response = await fetchWithAuth("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.error || "Failed to open billing portal");
        return;
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      }
    } catch (e) {
      console.error("Billing portal error:", e);
      Alert.alert("Error", "Failed to open billing portal");
      captureException(e as Error, { screen: "Settings", context: "billingPortal", orgId });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCloseBillingPortal = () => {
    setBillingPortalUrl(null);
    refetchSubscription();
  };

  // Update plan
  const handleUpdatePlan = async () => {
    if (!orgId) return;

    const targetLimit = ALUMNI_LIMITS[selectedBucket];
    if (subscription && targetLimit !== null && subscription.alumniCount > targetLimit) {
      Alert.alert("Error", "You have more alumni than this plan allows. Choose a larger plan.");
      return;
    }

    setPlanUpdating(true);
    try {
      const endpoint = !subscription?.stripeSubscriptionId
        ? `/api/organizations/${orgId}/start-checkout`
        : `/api/organizations/${orgId}/subscription`;

      const response = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniBucket: selectedBucket, interval: selectedInterval }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to update subscription");
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      } else {
        Alert.alert("Success", "Subscription updated.");
        refetchSubscription();
      }
    } catch (e) {
      Alert.alert("Error", (e as Error).message);
    } finally {
      setPlanUpdating(false);
    }
  };

  // Cancel subscription
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

  // Delete organization
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

  const statusInfo = subscription ? formatStatus(subscription.status, colors) : null;
  const activeMembers = memberships.filter((m) => m.status === "active");
  const revokedMembers = memberships.filter((m) => m.status === "revoked");
  const totalPending = pendingMembers.length + pendingAlumni.length;

  const renderSectionHeader = (title: string, section: string, icon: React.ReactNode, badge?: number) => (
    <TouchableOpacity
      style={styles.sectionHeader}
      onPress={() => toggleSection(section)}
      activeOpacity={0.7}
    >
      <View style={styles.sectionHeaderLeft}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge !== undefined && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <ChevronDown
        size={20}
        color={colors.mutedForeground}
        style={{ transform: [{ rotate: expandedSections[section] ? "180deg" : "0deg" }] }}
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Organization Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            {renderSectionHeader("Organization", "organization", <Building2 size={20} color={colors.muted} />)}
            {expandedSections.organization && (
              <View style={styles.card}>
                {orgLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <>
                    {/* Organization Name */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Organization Name</Text>
                      <TextInput
                        style={styles.input}
                        value={editedName}
                        onChangeText={setEditedName}
                        placeholder="Organization name"
                        placeholderTextColor={colors.mutedForeground}
                      />
                      {nameError && <Text style={styles.errorText}>{nameError}</Text>}
                      <TouchableOpacity
                        style={[styles.button, editedName === org?.name && styles.buttonDisabled]}
                        onPress={handleSaveName}
                        disabled={nameSaving || editedName === org?.name}
                      >
                        {nameSaving ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <Text style={styles.buttonText}>Save Name</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Branding Preview */}
                    <View style={styles.divider} />
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Branding</Text>
                      <View style={[styles.brandingPreview, { backgroundColor: org?.primary_color || colors.primary }]}>
                        {org?.logo_url ? (
                          <Image source={{ uri: org.logo_url }} style={styles.logoPreview} />
                        ) : (
                          <View style={styles.logoPlaceholder}>
                            <Building2 size={24} color="#fff" />
                          </View>
                        )}
                        <View>
                          <Text style={styles.brandingName}>{org?.name}</Text>
                          <Text style={styles.brandingSlug}>/{org?.slug}</Text>
                        </View>
                      </View>
                      <View style={styles.colorRow}>
                        <View style={styles.colorItem}>
                          <View style={[styles.colorSwatch, { backgroundColor: org?.primary_color || colors.primary }]} />
                          <Text style={styles.colorLabel}>Primary</Text>
                        </View>
                        <View style={styles.colorItem}>
                          <View style={[styles.colorSwatch, { backgroundColor: org?.secondary_color || colors.secondary }]} />
                          <Text style={styles.colorLabel}>Secondary</Text>
                        </View>
                      </View>
                      <Text style={styles.hintText}>
                        To change logo and colors, visit settings on the web.
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        )}

        {/* Notifications Section */}
        <View style={styles.section}>
          {renderSectionHeader("Notifications", "notifications", <Bell size={20} color={colors.muted} />)}
          {expandedSections.notifications && (
            <View style={styles.card}>
              {prefsLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Email Address</Text>
                    <TextInput
                      style={styles.input}
                      value={emailAddress}
                      onChangeText={setEmailAddress}
                      placeholder="you@example.com"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                      <Text style={styles.switchLabel}>Email Notifications</Text>
                      <Text style={styles.switchHint}>Receive updates via email</Text>
                    </View>
                    <Switch
                      value={emailEnabled}
                      onValueChange={setEmailEnabled}
                      trackColor={{ false: colors.border, true: colors.primaryLight }}
                      thumbColor={emailEnabled ? colors.primary : colors.card}
                    />
                  </View>

                  <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                      <Text style={styles.switchLabel}>Push Notifications</Text>
                      <Text style={styles.switchHint}>Announcements and events</Text>
                    </View>
                    <Switch
                      value={pushEnabled}
                      onValueChange={setPushEnabled}
                      trackColor={{ false: colors.border, true: colors.primaryLight }}
                      thumbColor={pushEnabled ? colors.primary : colors.card}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.button}
                    onPress={handleSaveNotifications}
                    disabled={prefsSaving}
                  >
                    {prefsSaving ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Text style={styles.buttonText}>Save Preferences</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>

        {/* Invites Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            {renderSectionHeader("Invites", "invites", <LinkIcon size={20} color={colors.muted} />, invites.filter(isInviteValid).length)}
            {expandedSections.invites && (
              <View style={styles.card}>
                {/* Quota Display */}
                {subscription && (
                  <View style={styles.quotaContainer}>
                    <View style={styles.quotaRow}>
                      <Text style={styles.quotaLabel}>Alumni Plan</Text>
                      <Text style={styles.quotaValue}>{formatBucket(subscription.bucket)}</Text>
                    </View>
                    <View style={styles.quotaRow}>
                      <Text style={styles.quotaLabel}>Alumni Used</Text>
                      <Text style={styles.quotaValue}>
                        {subscription.alumniCount} / {subscription.alumniLimit ?? "Unlimited"}
                      </Text>
                    </View>
                    <View style={styles.quotaRow}>
                      <Text style={styles.quotaLabel}>Remaining</Text>
                      <Text style={styles.quotaValue}>
                        {subscription.alumniLimit === null ? "Unlimited" : Math.max(subscription.alumniLimit - subscription.alumniCount, 0)}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.divider} />

                {/* Create Invite Button */}
                {!showInviteForm && (
                  <TouchableOpacity
                    style={styles.createButton}
                    onPress={() => setShowInviteForm(true)}
                  >
                    <Plus size={18} color={colors.primary} />
                    <Text style={styles.createButtonText}>Create Invite</Text>
                  </TouchableOpacity>
                )}

                {/* Create Invite Form */}
                {showInviteForm && (
                  <View style={styles.inviteForm}>
                    <Text style={styles.fieldLabel}>Role</Text>
                    <View style={styles.roleButtons}>
                      {(["active_member", "alumni", "admin"] as const).map((role) => (
                        <TouchableOpacity
                          key={role}
                          style={[styles.roleButton, inviteRole === role && styles.roleButtonActive]}
                          onPress={() => setInviteRole(role)}
                        >
                          <Text style={[styles.roleButtonText, inviteRole === role && styles.roleButtonTextActive]}>
                            {getRoleLabel(role)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.fieldLabel}>Max Uses (optional)</Text>
                    <TextInput
                      style={styles.input}
                      value={inviteUses}
                      onChangeText={setInviteUses}
                      placeholder="Unlimited"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="number-pad"
                    />

                    <View style={styles.formActions}>
                      <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={() => {
                          setShowInviteForm(false);
                          setInviteRole("active_member");
                          setInviteUses("");
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.button}
                        onPress={handleCreateInvite}
                        disabled={inviteCreating}
                      >
                        {inviteCreating ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <Text style={styles.buttonText}>Create</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Invites List */}
                {invitesLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : invites.length > 0 ? (
                  <View style={styles.invitesList}>
                    {invites.map((invite) => {
                      const valid = isInviteValid(invite);
                      const expired = isInviteExpired(invite.expires_at);
                      const revoked = isInviteRevoked(invite.revoked_at);
                      const exhausted = isInviteExhausted(invite.uses_remaining);

                      return (
                        <View key={invite.id} style={[styles.inviteItem, !valid && styles.inviteItemInvalid]}>
                          <View style={styles.inviteHeader}>
                            <Text style={styles.inviteCode}>{invite.code}</Text>
                            <View style={[styles.roleBadge, { backgroundColor: invite.role === "admin" ? colors.warning + "20" : invite.role === "alumni" ? colors.muted + "20" : colors.primary + "20" }]}>
                              <Text style={[styles.roleBadgeText, { color: invite.role === "admin" ? colors.warning : invite.role === "alumni" ? colors.foreground : colors.primary }]}>
                                {getRoleLabel(invite.role)}
                              </Text>
                            </View>
                            {expired && <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}><Text style={[styles.statusBadgeText, { color: colors.error }]}>Expired</Text></View>}
                            {revoked && <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}><Text style={[styles.statusBadgeText, { color: colors.error }]}>Revoked</Text></View>}
                            {exhausted && <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}><Text style={[styles.statusBadgeText, { color: colors.error }]}>No uses left</Text></View>}
                          </View>

                          <Text style={styles.inviteMeta}>
                            {invite.uses_remaining !== null ? `${invite.uses_remaining} uses left` : "Unlimited uses"}
                            {invite.expires_at && ` • Expires ${formatDate(invite.expires_at)}`}
                          </Text>

                          <View style={styles.inviteActions}>
                            <TouchableOpacity
                              style={styles.inviteAction}
                              onPress={() => copyInviteLink(invite)}
                            >
                              {copiedInviteId === invite.id ? (
                                <Check size={16} color={colors.success} />
                              ) : (
                                <Copy size={16} color={colors.primary} />
                              )}
                              <Text style={styles.inviteActionText}>
                                {copiedInviteId === invite.id ? "Copied!" : "Copy Link"}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.inviteAction}
                              onPress={() => setShowQRCode(showQRCode === invite.id ? null : invite.id)}
                            >
                              <QrCode size={16} color={colors.primary} />
                              <Text style={styles.inviteActionText}>QR</Text>
                            </TouchableOpacity>

                            {valid && (
                              <TouchableOpacity
                                style={styles.inviteAction}
                                onPress={() => {
                                  Alert.alert("Revoke Invite", "This invite will no longer be valid.", [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Revoke", style: "destructive", onPress: () => revokeInvite(invite.id) },
                                  ]);
                                }}
                              >
                                <X size={16} color={colors.warning} />
                                <Text style={[styles.inviteActionText, { color: colors.warning }]}>Revoke</Text>
                              </TouchableOpacity>
                            )}

                            <TouchableOpacity
                              style={styles.inviteAction}
                              onPress={() => {
                                Alert.alert("Delete Invite", "This will permanently delete the invite.", [
                                  { text: "Cancel", style: "cancel" },
                                  { text: "Delete", style: "destructive", onPress: () => deleteInvite(invite.id) },
                                ]);
                              }}
                            >
                              <Trash2 size={16} color={colors.error} />
                            </TouchableOpacity>
                          </View>

                          {showQRCode === invite.id && (
                            <View style={styles.qrContainer}>
                              <QRCode
                                value={getInviteLink(invite, getWebAppUrl())}
                                size={180}
                                backgroundColor={colors.card}
                                color={colors.foreground}
                              />
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>No invites yet. Create one to let people join.</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Access Control Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            {renderSectionHeader("Access Control", "access", <Users size={20} color={colors.muted} />, totalPending)}
            {expandedSections.access && (
              <View style={styles.card}>
                {membersLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <>
                    {/* Pending Approvals */}
                    {totalPending > 0 && (
                      <>
                        <Text style={styles.subsectionTitle}>Pending Approvals</Text>
                        {[...pendingMembers, ...pendingAlumni].map((member) => (
                          <View key={member.user_id} style={styles.memberItem}>
                            <View style={styles.memberInfo}>
                              {member.user?.avatar_url ? (
                                <Image source={{ uri: member.user.avatar_url }} style={styles.memberAvatar} />
                              ) : (
                                <View style={styles.memberAvatarPlaceholder}>
                                  <Text style={styles.memberAvatarText}>
                                    {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                              )}
                              <View style={styles.memberDetails}>
                                <Text style={styles.memberName}>{member.user?.name || member.user?.email || "Unknown"}</Text>
                                <Text style={styles.memberEmail}>{member.user?.email}</Text>
                                <Text style={styles.memberMeta}>Requested {formatDate(member.created_at)} • {getRoleLabel(member.role)}</Text>
                              </View>
                            </View>
                            <View style={styles.memberActions}>
                              <TouchableOpacity style={styles.approveButton} onPress={() => handleApproveMember(member.user_id)}>
                                <Check size={16} color={colors.success} />
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.rejectButton} onPress={() => handleRejectMember(member.user_id)}>
                                <X size={16} color={colors.error} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                        <View style={styles.divider} />
                      </>
                    )}

                    {/* Active Members */}
                    <Text style={styles.subsectionTitle}>Active Members ({activeMembers.length})</Text>
                    {activeMembers.map((member) => (
                      <View key={member.user_id} style={styles.memberItem}>
                        <View style={styles.memberInfo}>
                          {member.user?.avatar_url ? (
                            <Image source={{ uri: member.user.avatar_url }} style={styles.memberAvatar} />
                          ) : (
                            <View style={styles.memberAvatarPlaceholder}>
                              <Text style={styles.memberAvatarText}>
                                {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.memberDetails}>
                            <Text style={styles.memberName}>{member.user?.name || member.user?.email || "Unknown"}</Text>
                            <Text style={styles.memberEmail}>{member.user?.email}</Text>
                          </View>
                        </View>
                        <View style={styles.memberActions}>
                          <TouchableOpacity
                            style={styles.roleSelector}
                            onPress={() => {
                              Alert.alert("Change Role", "Select a new role for this member", [
                                { text: "Cancel", style: "cancel" },
                                { text: "Active Member", onPress: () => handleRoleChange(member.user_id, "active_member") },
                                { text: "Alumni", onPress: () => handleRoleChange(member.user_id, "alumni") },
                                { text: "Admin", onPress: () => handleRoleChange(member.user_id, "admin") },
                              ]);
                            }}
                          >
                            {roleChanging === member.user_id ? (
                              <ActivityIndicator size="small" color={colors.primary} />
                            ) : (
                              <>
                                <Text style={styles.roleSelectorText}>{getRoleLabel(member.role)}</Text>
                                <ChevronDown size={14} color={colors.mutedForeground} />
                              </>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.removeButton}
                            onPress={() => handleRemoveAccess(member.user_id)}
                          >
                            <X size={16} color={colors.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}

                    {/* Revoked Members */}
                    {revokedMembers.length > 0 && (
                      <>
                        <View style={styles.divider} />
                        <Text style={styles.subsectionTitle}>Revoked Access ({revokedMembers.length})</Text>
                        {revokedMembers.map((member) => (
                          <View key={member.user_id} style={[styles.memberItem, styles.memberItemRevoked]}>
                            <View style={styles.memberInfo}>
                              <View style={styles.memberAvatarPlaceholder}>
                                <Text style={styles.memberAvatarText}>
                                  {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.memberDetails}>
                                <Text style={styles.memberName}>{member.user?.name || member.user?.email || "Unknown"}</Text>
                                <Text style={styles.memberEmail}>{member.user?.email}</Text>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={styles.restoreButton}
                              onPress={() => handleRestoreAccess(member.user_id)}
                            >
                              <Text style={styles.restoreButtonText}>Restore</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </View>
        )}

        {/* Billing Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            {renderSectionHeader("Billing", "billing", <CreditCard size={20} color={colors.muted} />)}
            {expandedSections.billing && (
              <View style={styles.card}>
                {subLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadingText}>Loading subscription...</Text>
                  </View>
                ) : subError ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{subError}</Text>
                    <TouchableOpacity onPress={handleRefresh} style={styles.retryButton}>
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : subscription ? (
                  <>
                    <View style={styles.subscriptionCard}>
                      <View style={styles.subscriptionRow}>
                        <Text style={styles.subscriptionLabel}>Current Plan</Text>
                        <Text style={styles.subscriptionValue}>{formatBucket(subscription.bucket)}</Text>
                      </View>
                      <View style={styles.subscriptionRow}>
                        <Text style={styles.subscriptionLabel}>Status</Text>
                        <View style={[styles.statusBadgeLarge, { backgroundColor: statusInfo?.color + "20" }]}>
                          <View style={[styles.statusDot, { backgroundColor: statusInfo?.color }]} />
                          <Text style={[styles.statusTextLarge, { color: statusInfo?.color }]}>{statusInfo?.label}</Text>
                        </View>
                      </View>
                      {subscription.currentPeriodEnd && (
                        <View style={styles.subscriptionRow}>
                          <Text style={styles.subscriptionLabel}>Next Billing</Text>
                          <Text style={styles.subscriptionValue}>{formatDate(subscription.currentPeriodEnd)}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.divider} />

                    {/* Plan Selector */}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Change Plan</Text>
                      <TouchableOpacity
                        style={styles.pickerButton}
                        onPress={() => setShowBucketPicker(true)}
                      >
                        <Text style={styles.pickerButtonText}>
                          {BUCKET_OPTIONS.find((o) => o.value === selectedBucket)?.label || selectedBucket}
                        </Text>
                        <ChevronDown size={16} color={colors.mutedForeground} />
                      </TouchableOpacity>

                      <View style={styles.intervalRow}>
                        <TouchableOpacity
                          style={[styles.intervalButton, selectedInterval === "month" && styles.intervalButtonActive]}
                          onPress={() => setSelectedInterval("month")}
                        >
                          <Text style={[styles.intervalButtonText, selectedInterval === "month" && styles.intervalButtonTextActive]}>Monthly</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.intervalButton, selectedInterval === "year" && styles.intervalButtonActive]}
                          onPress={() => setSelectedInterval("year")}
                        >
                          <Text style={[styles.intervalButtonText, selectedInterval === "year" && styles.intervalButtonTextActive]}>Yearly (save ~17%)</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity
                        style={[styles.button, (planUpdating || selectedBucket === subscription.bucket) && styles.buttonDisabled]}
                        onPress={handleUpdatePlan}
                        disabled={planUpdating || selectedBucket === subscription.bucket}
                      >
                        {planUpdating ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <Text style={styles.buttonText}>Update Plan</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    {/* Manage Billing */}
                    <TouchableOpacity
                      style={styles.billingButton}
                      onPress={handleManageBilling}
                      disabled={billingLoading || !subscription.stripeCustomerId}
                    >
                      {billingLoading ? (
                        <ActivityIndicator size="small" color={colors.primaryForeground} />
                      ) : (
                        <>
                          <CreditCard size={18} color={colors.primaryForeground} />
                          <Text style={styles.billingButtonText}>Manage Billing</Text>
                          <ExternalLink size={16} color={colors.primaryForeground} />
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.noSubscription}>
                    <Text style={styles.noSubscriptionText}>No active subscription found.</Text>
                    <Text style={styles.noSubscriptionHint}>Set up billing from the web app.</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Danger Zone - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            {renderSectionHeader("Danger Zone", "danger", <AlertTriangle size={20} color={colors.warning} />)}
            {expandedSections.danger && (
              <View style={[styles.card, styles.dangerCard]}>
                <View style={styles.dangerItem}>
                  <View style={styles.dangerInfo}>
                    <Text style={styles.dangerTitle}>Cancel Subscription</Text>
                    <Text style={styles.dangerDescription}>
                      Your subscription will remain active until the end of your billing period.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.dangerButton}
                    onPress={handleCancelSubscription}
                    disabled={cancelling || subscription?.status === "canceling" || subscription?.status === "canceled"}
                  >
                    {cancelling ? (
                      <ActivityIndicator size="small" color={colors.warning} />
                    ) : (
                      <Text style={styles.dangerButtonText}>
                        {subscription?.status === "canceling" ? "Cancelling..." : "Cancel"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                <View style={styles.dangerItem}>
                  <View style={styles.dangerInfo}>
                    <Text style={styles.dangerTitle}>Delete Organization</Text>
                    <Text style={styles.dangerDescription}>
                      Permanently delete this organization and all its data. This cannot be undone.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.dangerButton, styles.deleteButton]}
                    onPress={handleDeleteOrganization}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* About Section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <Info size={20} color={colors.muted} />
              <Text style={styles.aboutLabel}>App Version</Text>
              <Text style={styles.aboutValue}>{Constants.expoConfig?.version || "1.0.0"}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Stripe Billing Portal WebView */}
      {billingPortalUrl && (
        <StripeWebView
          visible={!!billingPortalUrl}
          url={billingPortalUrl}
          onClose={handleCloseBillingPortal}
          title="Billing Portal"
          successUrls={[`/${orgSlug}`]}
          cancelUrls={[`/${orgSlug}`]}
        />
      )}

      {/* Admin Promotion Confirmation Modal */}
      <Modal visible={showAdminConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Promote to Admin?</Text>
            <Text style={styles.modalDescription}>
              Admins have full access to organization settings, billing, and member management.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAdminConfirm(false);
                  setPendingAdminUserId(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={confirmAdminPromotion}>
                <Text style={styles.modalConfirmText}>Promote</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
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
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteButton, (deleting || deleteConfirmText !== org?.name) && styles.buttonDisabled]}
                onPress={confirmDeleteOrganization}
                disabled={deleting || deleteConfirmText !== org?.name}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bucket Picker Modal */}
      <Modal visible={showBucketPicker} transparent animationType="slide">
        <Pressable style={styles.pickerOverlay} onPress={() => setShowBucketPicker(false)}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Alumni Plan</Text>
            {BUCKET_OPTIONS.map((option) => {
              const limit = ALUMNI_LIMITS[option.value];
              const disabled = subscription && limit !== null && subscription.alumniCount > limit;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.pickerOption, disabled && styles.pickerOptionDisabled]}
                  onPress={() => {
                    if (!disabled) {
                      setSelectedBucket(option.value);
                      setShowBucketPicker(false);
                    }
                  }}
                  disabled={disabled}
                >
                  <Text style={[styles.pickerOptionText, disabled && styles.pickerOptionTextDisabled]}>
                    {option.label}
                  </Text>
                  {selectedBucket === option.value && <Check size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
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
      fontSize: 16,
      fontWeight: "600",
      color: colors.foreground,
    },
    badge: {
      backgroundColor: colors.warning,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    badgeText: {
      color: "#fff",
      fontSize: 12,
      fontWeight: "600",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderCurve: "continuous",
    },
    loadingContainer: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    loadingText: {
      fontSize: 14,
      color: colors.muted,
    },
    errorContainer: {
      padding: 16,
      alignItems: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      textAlign: "center",
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    retryButtonText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontWeight: "600",
    },
    fieldGroup: {
      marginBottom: 16,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.foreground,
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: 16,
      color: colors.foreground,
      marginBottom: 12,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: "600",
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
    },
    hintText: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 8,
    },
    brandingPreview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
    },
    logoPreview: {
      width: 48,
      height: 48,
      borderRadius: 12,
    },
    logoPlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    brandingName: {
      fontSize: 16,
      fontWeight: "600",
      color: "#fff",
    },
    brandingSlug: {
      fontSize: 14,
      color: "rgba(255,255,255,0.8)",
    },
    colorRow: {
      flexDirection: "row",
      gap: 24,
    },
    colorItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    colorSwatch: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorLabel: {
      fontSize: 14,
      color: colors.muted,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    switchInfo: {
      flex: 1,
    },
    switchLabel: {
      fontSize: 16,
      color: colors.foreground,
    },
    switchHint: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    quotaContainer: {
      gap: 8,
    },
    quotaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    quotaLabel: {
      fontSize: 14,
      color: colors.muted,
    },
    quotaValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.foreground,
    },
    createButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: "dashed",
    },
    createButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.primary,
    },
    inviteForm: {
      marginTop: 16,
    },
    roleButtons: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 16,
    },
    roleButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    roleButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10",
    },
    roleButtonText: {
      fontSize: 14,
      color: colors.muted,
    },
    roleButtonTextActive: {
      color: colors.primary,
      fontWeight: "600",
    },
    formActions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    cancelButtonText: {
      fontSize: 16,
      color: colors.muted,
    },
    invitesList: {
      marginTop: 16,
      gap: 12,
    },
    inviteItem: {
      backgroundColor: colors.background,
      padding: 12,
      borderRadius: 8,
    },
    inviteItemInvalid: {
      opacity: 0.6,
    },
    inviteHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    inviteCode: {
      fontSize: 18,
      fontWeight: "700",
      fontFamily: "monospace",
      color: colors.foreground,
    },
    roleBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    roleBadgeText: {
      fontSize: 12,
      fontWeight: "600",
    },
    statusBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    statusBadgeText: {
      fontSize: 12,
      fontWeight: "500",
    },
    inviteMeta: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 8,
    },
    inviteActions: {
      flexDirection: "row",
      gap: 16,
      marginTop: 12,
    },
    inviteAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    inviteActionText: {
      fontSize: 14,
      color: colors.primary,
    },
    qrContainer: {
      alignItems: "center",
      paddingTop: 16,
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    emptyText: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 24,
    },
    subsectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    memberItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    memberItemRevoked: {
      opacity: 0.6,
    },
    memberInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      gap: 12,
    },
    memberAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    memberAvatarPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    memberAvatarText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.primary,
    },
    memberDetails: {
      flex: 1,
    },
    memberName: {
      fontSize: 15,
      fontWeight: "500",
      color: colors.foreground,
    },
    memberEmail: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    memberMeta: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
    },
    memberActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    approveButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.success + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    rejectButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.error + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    roleSelector: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    roleSelectorText: {
      fontSize: 13,
      color: colors.foreground,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    restoreButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    restoreButtonText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.primaryForeground,
    },
    subscriptionCard: {
      gap: 12,
    },
    subscriptionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    subscriptionLabel: {
      fontSize: 14,
      color: colors.muted,
    },
    subscriptionValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.foreground,
    },
    statusBadgeLarge: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusTextLarge: {
      fontSize: 13,
      fontWeight: "600",
    },
    pickerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    pickerButtonText: {
      fontSize: 16,
      color: colors.foreground,
    },
    intervalRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 12,
    },
    intervalButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    intervalButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10",
    },
    intervalButtonText: {
      fontSize: 14,
      color: colors.muted,
    },
    intervalButtonTextActive: {
      color: colors.primary,
      fontWeight: "600",
    },
    billingButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      gap: 8,
    },
    billingButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: "600",
    },
    noSubscription: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    noSubscriptionText: {
      fontSize: 15,
      fontWeight: "500",
      color: colors.foreground,
      textAlign: "center",
    },
    noSubscriptionHint: {
      fontSize: 14,
      color: colors.muted,
      textAlign: "center",
    },
    dangerCard: {
      borderWidth: 1,
      borderColor: colors.warning + "50",
      backgroundColor: colors.warning + "08",
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
      fontWeight: "500",
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
      fontSize: 14,
      fontWeight: "500",
      color: colors.warning,
    },
    deleteButton: {
      backgroundColor: colors.error,
      borderColor: colors.error,
    },
    deleteButtonText: {
      fontSize: 14,
      fontWeight: "500",
      color: "#fff",
    },
    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    aboutLabel: {
      flex: 1,
      fontSize: 16,
      color: colors.foreground,
    },
    aboutValue: {
      fontSize: 14,
      color: colors.muted,
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
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
      marginBottom: 12,
    },
    modalDescription: {
      fontSize: 15,
      color: colors.mutedForeground,
      marginBottom: 20,
    },
    modalBold: {
      fontWeight: "600",
      color: colors.foreground,
    },
    modalInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: 16,
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
      fontSize: 16,
      color: colors.muted,
    },
    modalConfirmButton: {
      flex: 1,
      backgroundColor: colors.warning,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    modalConfirmText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#fff",
    },
    modalDeleteButton: {
      flex: 1,
      backgroundColor: colors.error,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    modalDeleteText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#fff",
    },
    pickerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    pickerContent: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    pickerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
      marginBottom: 16,
      textAlign: "center",
    },
    pickerOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pickerOptionDisabled: {
      opacity: 0.5,
    },
    pickerOptionText: {
      fontSize: 16,
      color: colors.foreground,
    },
    pickerOptionTextDisabled: {
      color: colors.muted,
    },
  });
