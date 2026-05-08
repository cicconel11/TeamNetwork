import React from "react";
import { Text, View } from "react-native";

import {
  describeEventStatus,
  getEventStatus,
  type EventStatus,
} from "@teammeet/core/calendar";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useNow } from "@/hooks/useNow";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { ENERGY, RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface Props {
  startAt: string;
  endAt: string | null;
  gracePeriodMinutes?: number;
}

type Tone = "live" | "soon" | "ended";

function toneFor(kind: EventStatus["kind"]): Tone | null {
  switch (kind) {
    case "live":
      return "live";
    case "starting-soon":
      return "soon";
    case "recently-ended":
      return "ended";
    default:
      return null;
  }
}

export function EventCountdownBadge({
  startAt,
  endAt,
  gracePeriodMinutes,
}: Props) {
  const { semantic, neutral } = useAppColorScheme();
  const now = useNow(startAt);
  const status = getEventStatus(startAt, endAt, now, gracePeriodMinutes);
  const tone = toneFor(status.kind);

  const palettes: Record<Tone, { bg: string; fg: string }> = {
    live: { bg: ENERGY.liveGlow, fg: ENERGY.live },
    soon: { bg: semantic.infoLight, fg: semantic.info },
    ended: { bg: neutral.divider, fg: neutral.muted },
  };

  const styles = useThemedStyles(() => ({
    badge: {
      alignSelf: "flex-start" as const,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      marginTop: 4,
    },
    label: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
    },
  }));

  if (!tone) return null;

  return (
    <View style={[styles.badge, { backgroundColor: palettes[tone].bg }]}>
      <Text style={[styles.label, { color: palettes[tone].fg }]}>
        {describeEventStatus(status)}
      </Text>
    </View>
  );
}
