import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Switch, Alert, ActivityIndicator } from "react-native";
import { CalendarPlus, ChevronDown } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useDevicePermission } from "@/lib/device-permissions";
import {
  isOrgCalendarSyncEnabled,
  setOrgCalendarSyncEnabled,
} from "@/lib/native-calendar-prefs";
import {
  removeOrgCalendar,
  syncEventToDevice,
  type CalendarSyncEvent,
} from "@/lib/native-calendar";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { captureException } from "@/lib/analytics";

interface Props {
  orgId: string;
  orgName: string | null;
}

const SYNC_HORIZON_DAYS = 90;

/**
 * Per-org device-calendar sync toggle. On enable, batch-imports the next
 * SYNC_HORIZON_DAYS of events into a `TeamMeet — {orgName}` device calendar.
 * On disable, removes the entire calendar from the device.
 *
 * Future events created after the toggle are not auto-mirrored yet (realtime
 * triggers are a follow-up). Users can still add individual events from the
 * event-detail "Add to Calendar" menu.
 */
export function SettingsCalendarSection({ orgId, orgName }: Props) {
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();
  const calendarPermission = useDevicePermission("calendar");

  const [enabled, setEnabled] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    isOrgCalendarSyncEnabled(orgId).then((on) => {
      if (cancelled) return;
      setEnabled(on);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const styles = useThemedStyles((n) => ({
    body: { paddingHorizontal: 20, paddingBottom: 20 },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 8,
    },
    rowLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: n.foreground,
    },
    hint: { fontSize: fontSize.sm, color: n.muted, marginTop: 4 },
    note: { fontSize: fontSize.sm, color: n.muted, marginTop: 12 },
    busyRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginTop: 12,
    },
  }));

  if (!resolved || calendarPermission.status === "unsupported") return null;

  const handleEnable = async () => {
    if (calendarPermission.status !== "granted") {
      const next = await calendarPermission.request();
      if (next !== "granted") {
        if (!calendarPermission.canAskAgain) {
          Alert.alert(
            "Calendar access needed",
            "Open Settings to allow TeamMeet to add events to your calendar.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => void calendarPermission.openSettings(),
              },
            ]
          );
        }
        return;
      }
    }

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + SYNC_HORIZON_DAYS);

    const { data, error } = await supabase
      .from("events")
      .select("id, title, description, location, start_date, end_date, deleted_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gte("start_date", new Date().toISOString())
      .lte("start_date", horizon.toISOString());

    if (error) {
      Alert.alert("Couldn't load events", error.message);
      return;
    }

    const events = (data ?? []) as Array<CalendarSyncEvent & { deleted_at: string | null }>;
    let count = 0;
    for (const event of events) {
      try {
        await syncEventToDevice({
          orgId,
          orgName: orgName ?? "TeamMeet",
          event,
        });
        count += 1;
      } catch (err) {
        captureException(err as Error, {
          context: "SettingsCalendarSection.syncEvent",
          eventId: event.id,
        });
      }
    }

    await setOrgCalendarSyncEnabled(orgId, true);
    setEnabled(true);
    setSyncedCount(count);
  };

  const handleDisable = async () => {
    try {
      await removeOrgCalendar(orgId);
    } catch (err) {
      captureException(err as Error, {
        context: "SettingsCalendarSection.removeOrgCalendar",
      });
    }
    await setOrgCalendarSyncEnabled(orgId, false);
    setEnabled(false);
    setSyncedCount(null);
  };

  const handleToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) await handleEnable();
      else await handleDisable();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <CalendarPlus size={20} color={colors.primary} />
          <Text style={baseStyles.sectionTitle}>Device calendar</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.muted}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLabel}>Sync this org&apos;s events</Text>
              <Text style={styles.hint}>
                Adds upcoming events to a &quot;TeamMeet — {orgName ?? "Org"}&quot;
                calendar on your device. You can hide or delete that calendar
                from your phone&apos;s Calendar settings without affecting the rest
                of TeamMeet.
              </Text>
            </View>
            <Switch value={enabled} onValueChange={handleToggle} disabled={busy} />
          </View>

          {busy && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.hint}>
                {enabled ? "Removing calendar…" : "Importing upcoming events…"}
              </Text>
            </View>
          )}

          {syncedCount != null && enabled && !busy && (
            <Text style={styles.note}>
              Imported {syncedCount} upcoming event{syncedCount === 1 ? "" : "s"}.
              Events created later can be added individually from the event screen.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
