import React, { useCallback, useMemo, forwardRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
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
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

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
              <TouchableOpacity
                key={index}
                style={styles.actionTile}
                onPress={action.onPress}
                activeOpacity={0.7}
              >
                <View style={styles.iconContainer}>{action.icon}</View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

ActionSheet.displayName = "ActionSheet";

const styles = StyleSheet.create({
  background: {
    backgroundColor: NEUTRAL.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  indicator: {
    backgroundColor: NEUTRAL.border,
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.lg,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  actionTile: {
    width: "48%",
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    alignItems: "center",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  actionLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: "#ffffff",
    textAlign: "center",
  },
});
