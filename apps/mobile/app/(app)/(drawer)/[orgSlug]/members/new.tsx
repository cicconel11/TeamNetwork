import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";

type InviteRole = "active_member" | "admin" | "alumni";

type InviteRecord = {
  id: string;
  code: string | null;
  token: string | null;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
};

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "active_member", label: "Active Member" },
  { value: "alumni", label: "Alumni" },
  { value: "admin", label: "Admin" },
];

export default function NewMemberInviteScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { colors } = useOrgTheme();

  const [role, setRole] = useState<InviteRole>("active_member");
  const [uses, setUses] = useState("");
  const [expires, setExpires] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteRecord | null>(null);

  const inviteLink = useMemo(() => {
    if (!invite) return null;
    const base = getWebAppUrl();
    if (invite.token) {
      return `${base}/app/join?token=${invite.token}`;
    }
    if (invite.code) {
      return `${base}/app/join?code=${invite.code}`;
    }
    return null;
  }, [invite]);

  const handleShare = async () => {
    if (!inviteLink) return;
    try {
      await Share.share({ message: inviteLink });
    } catch (shareError) {
      console.warn("Share failed:", shareError);
    }
  };

  const handleSubmit = async () => {
    if (!orgId) {
      setError("Organization not loaded yet.");
      return;
    }

    const usesValue = uses.trim() ? Number(uses.trim()) : null;
    if (usesValue !== null && (!Number.isFinite(usesValue) || usesValue <= 0)) {
      setError("Uses must be a positive number.");
      return;
    }

    let expiresAt: string | null = null;
    if (expires.trim()) {
      const parsed = new Date(`${expires.trim()}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        setError("Enter a valid expiration date.");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("create_org_invite", {
        p_organization_id: orgId,
        p_role: role,
        p_uses: usesValue ?? undefined,
        p_expires_at: expiresAt ?? undefined,
      });

      if (rpcError || !data) {
        throw rpcError || new Error("Failed to create invite.");
      }

      setInvite(data as InviteRecord);
    } catch (e) {
      setError((e as Error).message || "Failed to create invite.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.primary }}
      contentContainerStyle={{
        padding: spacing.md,
        gap: spacing.lg,
      }}
    >
      {error && (
        <View
          style={{
            backgroundColor: `${colors.error}20`,
            borderRadius: borderRadius.md,
            padding: spacing.sm,
          }}
        >
          <Text selectable style={{ color: colors.error, fontSize: fontSize.sm }}>
            {error}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Role</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {ROLE_OPTIONS.map((option) => {
            const selected = role === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setRole(option.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryLight : colors.card,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Uses (optional)</Text>
        <TextInput
          value={uses}
          onChangeText={setUses}
          placeholder="Unlimited"
          placeholderTextColor={colors.secondaryForeground}
          keyboardType="number-pad"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Expires on (optional)</Text>
        <TextInput
          value={expires}
          onChangeText={setExpires}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.secondaryForeground}
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={isSaving}
        style={{
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          opacity: isSaving ? 0.7 : 1,
        }}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>
            Create Invite
          </Text>
        )}
      </TouchableOpacity>

      {invite && (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: borderRadius.lg,
            padding: spacing.md,
            gap: spacing.sm,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground }}>
            Invite ready
          </Text>
          {invite.code && (
            <Text selectable style={{ fontSize: fontSize.base, color: colors.foreground }}>
              Code: {invite.code}
            </Text>
          )}
          {inviteLink && (
            <>
              <Text selectable style={{ fontSize: fontSize.sm, color: colors.mutedForeground }}>
                {inviteLink}
              </Text>
              <View
                style={{
                  alignItems: "center",
                  paddingVertical: spacing.sm,
                  borderRadius: borderRadius.md,
                  backgroundColor: colors.mutedSurface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <QRCode value={inviteLink} size={180} />
                <Text
                  style={{
                    marginTop: spacing.sm,
                    fontSize: fontSize.sm,
                    color: colors.mutedForeground,
                  }}
                >
                  Scan to join
                </Text>
              </View>
            </>
          )}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <TouchableOpacity
              onPress={handleShare}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                paddingVertical: spacing.sm,
                alignItems: "center",
                backgroundColor: colors.card,
              }}
            >
              <Text style={{ fontSize: fontSize.base, color: colors.foreground }}>
                Share Link
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/members`)}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                paddingVertical: spacing.sm,
                alignItems: "center",
                backgroundColor: colors.card,
              }}
            >
              <Text style={{ fontSize: fontSize.base, color: colors.foreground }}>
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
