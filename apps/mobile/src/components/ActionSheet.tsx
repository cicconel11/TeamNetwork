import React, { useCallback, useMemo, forwardRef } from "react";
import { View, Text, Pressable } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  CalendarPlus,
  Megaphone,
  UserPlus,
  HandCoins,
  CalendarCheck,
  MapPin,
  Share2,
} from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface ActionSheetProps {
  isAdmin: boolean;
  onClose: () => void;
  onCreateEvent?: () => void;
  onPostAnnouncement?: () => void;
  onInviteMember?: () => void;
  onRecordDonation?: () => void;
  onRsvpEvent?: () => void;
  onCheckIn?: () => void;
  onShareOrg?: () => void;
}

interface ActionItem {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}

const ICON_COLOR = "#ffffff";

export const ActionSheet = forwardRef<BottomSheet, ActionSheetProps>(
  (
    {
      isAdmin,
      onClose,
      onCreateEvent,
      onPostAnnouncement,
      onInviteMember,
      onRecordDonation,
      onRsvpEvent,
      onCheckIn,
      onShareOrg,
    },
    ref
  ) => {
    const { neutral, semantic } = useAppColorScheme();
    const styles = useThemedStyles((n, s) => ({
      background: {
        backgroundColor: n.surface,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
      },
      indicator: {
        backgroundColor: n.border,
        width: 40,
      },
      content: {
        flex: 1,
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.sm,
      },
      title: {
        ...TYPOGRAPHY.titleMedium,
        color: n.foreground,
        marginBottom: SPACING.lg,
        textAlign: "center" as const,
      },
      grid: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        justifyContent: "space-between" as const,
      },
      actionTile: {
        width: "48%" as const,
        backgroundColor: s.success,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
        alignItems: "center" as const,
      },
      iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: "rgba(0, 0, 0, 0.15)",
        alignItems: "center" as const,
        justifyContent: "center" as const,
        marginBottom: SPACING.sm,
      },
      actionLabel: {
        ...TYPOGRAPHY.labelMedium,
        color: "#ffffff",
        textAlign: "center" as const,
      },
    }));

    const snapPoints = useMemo(() => ["40%"], []);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    const adminActions: ActionItem[] = [
      {
        icon: <CalendarPlus size={24} color={ICON_COLOR} />,
        label: "Create Event",
        onPress: () => {
          onCreateEvent?.();
          onClose();
        },
      },
      {
        icon: <Megaphone size={24} color={ICON_COLOR} />,
        label: "Post Announcement",
        onPress: () => {
          onPostAnnouncement?.();
          onClose();
        },
      },
      {
        icon: <UserPlus size={24} color={ICON_COLOR} />,
        label: "Invite Member",
        onPress: () => {
          onInviteMember?.();
          onClose();
        },
      },
      {
        icon: <HandCoins size={24} color={ICON_COLOR} />,
        label: "Record Donation",
        onPress: () => {
          onRecordDonation?.();
          onClose();
        },
      },
    ];

    const memberActions: ActionItem[] = [
      {
        icon: <CalendarCheck size={24} color={ICON_COLOR} />,
        label: "RSVP to Event",
        onPress: () => {
          onRsvpEvent?.();
          onClose();
        },
      },
      {
        icon: <MapPin size={24} color={ICON_COLOR} />,
        label: "Check In",
        onPress: () => {
          onCheckIn?.();
          onClose();
        },
      },
      {
        icon: <Share2 size={24} color={ICON_COLOR} />,
        label: "Share Org",
        onPress: () => {
          onShareOrg?.();
          onClose();
        },
      },
    ];

    const actions = isAdmin ? adminActions : memberActions;

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.indicator}
      >
        <BottomSheetView style={styles.content}>
          <Text style={styles.title}>Quick Actions</Text>
          <View style={styles.grid}>
            {actions.map((action, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}
                onPress={action.onPress}
              >
                <View style={styles.iconContainer}>{action.icon}</View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

ActionSheet.displayName = "ActionSheet";
