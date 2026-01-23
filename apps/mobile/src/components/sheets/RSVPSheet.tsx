/**
 * RSVPSheet Component
 * Bottom sheet for RSVP selection
 */

import React, { forwardRef, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { Check, HelpCircle, X, Calendar } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, RSVP_COLORS, RADIUS, SPACING, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { Button, type RSVPStatus } from "@/components/ui/Button";

interface RSVPSheetProps {
  eventTitle?: string;
  eventDate?: string;
  currentStatus?: RSVPStatus | null;
  onSelect: (status: RSVPStatus) => void;
  onAddToCalendar?: () => void;
  onClose?: () => void;
  accentColor?: string;
}

interface RSVPOptionProps {
  status: RSVPStatus;
  selected: boolean;
  onPress: () => void;
}

function RSVPOption({ status, selected, onPress }: RSVPOptionProps) {
  const colors = RSVP_COLORS[status];

  const getIcon = () => {
    switch (status) {
      case "going":
        return <Check size={20} color={selected ? colors.text : NEUTRAL.muted} />;
      case "maybe":
        return <HelpCircle size={20} color={selected ? colors.text : NEUTRAL.muted} />;
      case "declined":
        return <X size={20} color={selected ? colors.text : NEUTRAL.muted} />;
    }
  };

  const getLabel = () => {
    switch (status) {
      case "going":
        return "Going";
      case "maybe":
        return "Maybe";
      case "declined":
        return "Can't Go";
    }
  };

  const getDescription = () => {
    switch (status) {
      case "going":
        return "I'll be there!";
      case "maybe":
        return "I'm not sure yet";
      case "declined":
        return "I can't make it";
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && { backgroundColor: colors.background, borderColor: colors.border },
        pressed && styles.optionPressed,
      ]}
    >
      <View
        style={[
          styles.optionIcon,
          selected && { backgroundColor: colors.background },
        ]}
      >
        {getIcon()}
      </View>

      <View style={styles.optionContent}>
        <Text
          style={[
            styles.optionLabel,
            selected && { color: colors.text },
          ]}
        >
          {getLabel()}
        </Text>
        <Text style={styles.optionDescription}>{getDescription()}</Text>
      </View>

      {selected && (
        <View style={[styles.selectedIndicator, { backgroundColor: colors.text }]} />
      )}
    </Pressable>
  );
}

export const RSVPSheet = forwardRef<BottomSheet, RSVPSheetProps>(
  function RSVPSheet(
    {
      eventTitle,
      eventDate,
      currentStatus,
      onSelect,
      onAddToCalendar,
      onClose,
      accentColor,
    },
    ref
  ) {
    const snapPoints = useMemo(() => ["55%"], []);

    const handleSelect = useCallback(
      (status: RSVPStatus) => {
        onSelect(status);
      },
      [onSelect]
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.indicator}
        backgroundStyle={styles.background}
        onClose={onClose}
      >
        <BottomSheetView style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>RSVP</Text>
            {eventTitle && (
              <Text style={styles.eventTitle} numberOfLines={1}>
                {eventTitle}
              </Text>
            )}
            {eventDate && (
              <Text style={styles.eventDate}>{eventDate}</Text>
            )}
          </View>

          {/* Options */}
          <View style={styles.options}>
            <RSVPOption
              status="going"
              selected={currentStatus === "going"}
              onPress={() => handleSelect("going")}
            />
            <RSVPOption
              status="maybe"
              selected={currentStatus === "maybe"}
              onPress={() => handleSelect("maybe")}
            />
            <RSVPOption
              status="declined"
              selected={currentStatus === "declined"}
              onPress={() => handleSelect("declined")}
            />
          </View>

          {/* Add to Calendar */}
          {onAddToCalendar && currentStatus === "going" && (
            <View style={styles.calendarAction}>
              <Pressable
                onPress={onAddToCalendar}
                style={({ pressed }) => [
                  styles.calendarButton,
                  pressed && styles.calendarButtonPressed,
                ]}
              >
                <Calendar size={18} color={SEMANTIC.success} />
                <Text style={styles.calendarText}>Add to Calendar</Text>
              </Pressable>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  background: {
    backgroundColor: NEUTRAL.surface,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
  },
  indicator: {
    backgroundColor: NEUTRAL.border,
    width: 36,
    height: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  header: {
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  title: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  eventTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.secondary,
    textAlign: "center",
  },
  eventDate: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
    marginTop: 4,
  },
  options: {
    gap: SPACING.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.background,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  optionPressed: {
    opacity: 0.8,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: NEUTRAL.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
  },
  optionDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  selectedIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calendarAction: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL.divider,
  },
  calendarButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  calendarButtonPressed: {
    opacity: 0.7,
  },
  calendarText: {
    ...TYPOGRAPHY.labelLarge,
    color: SEMANTIC.success,
  },
});
