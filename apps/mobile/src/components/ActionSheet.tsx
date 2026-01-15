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
        icon: <CalendarPlus size={24} color="#2563eb" />,
        label: "Create Event",
        onPress: () => {
          onCreateEvent?.();
          onClose();
        },
      },
      {
        icon: <Megaphone size={24} color="#2563eb" />,
        label: "Post Announcement",
        onPress: () => {
          onPostAnnouncement?.();
          onClose();
        },
      },
      {
        icon: <UserPlus size={24} color="#2563eb" />,
        label: "Invite Member",
        onPress: () => {
          onInviteMember?.();
          onClose();
        },
      },
      {
        icon: <HandCoins size={24} color="#2563eb" />,
        label: "Record Donation",
        onPress: () => {
          onRecordDonation?.();
          onClose();
        },
      },
    ];

    const memberActions: ActionItem[] = [
      {
        icon: <CalendarCheck size={24} color="#2563eb" />,
        label: "RSVP to Event",
        onPress: () => {
          onRsvpEvent?.();
          onClose();
        },
      },
      {
        icon: <MapPin size={24} color="#2563eb" />,
        label: "Check In",
        onPress: () => {
          onCheckIn?.();
          onClose();
        },
      },
      {
        icon: <Share2 size={24} color="#2563eb" />,
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
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  indicator: {
    backgroundColor: "#d1d5db",
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 20,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  actionTile: {
    width: "48%",
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e0e7ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1a1a1a",
    textAlign: "center",
  },
});
