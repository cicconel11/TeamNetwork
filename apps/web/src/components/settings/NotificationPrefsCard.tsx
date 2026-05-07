"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, ToggleSwitch } from "@/components/ui";

interface NotificationPrefsCardProps {
  orgId: string;
  orgName: string;
  userId: string;
  initialPrefs: {
    prefId: string | null;
    email: string;
    emailEnabled: boolean;
    announcementEnabled: boolean;
    discussionEnabled: boolean;
    eventEnabled: boolean;
    workoutEnabled: boolean;
    competitionEnabled: boolean;
  };
}

export function NotificationPrefsCard({ orgId, orgName, userId, initialPrefs }: NotificationPrefsCardProps) {
  const supabase = useMemo(() => createClient(), []);
  const tSettings = useTranslations("settings");
  const [prefId, setPrefId] = useState(initialPrefs.prefId);
  const [email, setEmail] = useState(initialPrefs.email);
  const [emailEnabled, setEmailEnabled] = useState(initialPrefs.emailEnabled);
  const [announcementEnabled, setAnnouncementEnabled] = useState(initialPrefs.announcementEnabled);
  const [discussionEnabled, setDiscussionEnabled] = useState(initialPrefs.discussionEnabled);
  const [eventEnabled, setEventEnabled] = useState(initialPrefs.eventEnabled);
  const [workoutEnabled, setWorkoutEnabled] = useState(initialPrefs.workoutEnabled);
  const [competitionEnabled, setCompetitionEnabled] = useState(initialPrefs.competitionEnabled);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefSuccess, setPrefSuccess] = useState<string | null>(null);

  const handlePreferenceSave = async () => {
    setPrefSaving(true);
    setPrefError(null);
    setPrefSuccess(null);

    const { error: upsertError, data } = await supabase
      .from("notification_preferences")
      .upsert({
        id: prefId || undefined,
        organization_id: orgId,
        user_id: userId,
        email_address: email.trim() || null,
        email_enabled: emailEnabled,
        announcement_emails_enabled: announcementEnabled,
        discussion_emails_enabled: discussionEnabled,
        event_emails_enabled: eventEnabled,
        workout_emails_enabled: workoutEnabled,
        competition_emails_enabled: competitionEnabled,
        phone_number: null,
        sms_enabled: false,
      })
      .select("id")
      .maybeSingle();

    if (upsertError) {
      setPrefError(upsertError.message);
      setPrefSaving(false);
      return;
    }

    setPrefId(data?.id || prefId);
    setPrefSaving(false);
    setPrefSuccess(tSettings("notifications.saved"));
  };

  const toggleItems = [
    { key: "announcement" as const, label: tSettings("notifications.categories.announcements.label"), desc: tSettings("notifications.categories.announcements.desc"), checked: announcementEnabled, set: setAnnouncementEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg> },
    { key: "discussion" as const, label: tSettings("notifications.categories.discussions.label"), desc: tSettings("notifications.categories.discussions.desc"), checked: discussionEnabled, set: setDiscussionEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
    { key: "event" as const, label: tSettings("notifications.categories.events.label"), desc: tSettings("notifications.categories.events.desc"), checked: eventEnabled, set: setEventEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
    { key: "workout" as const, label: tSettings("notifications.categories.workouts.label"), desc: tSettings("notifications.categories.workouts.desc"), checked: workoutEnabled, set: setWorkoutEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M4 6.5a2.5 2.5 0 0 1 0-5h0a2.5 2.5 0 0 1 0 5"/><path d="M20 6.5a2.5 2.5 0 0 0 0-5h0a2.5 2.5 0 0 0 0 5"/><path d="M4 17.5a2.5 2.5 0 0 0 0 5h0a2.5 2.5 0 0 0 0-5"/><path d="M20 17.5a2.5 2.5 0 0 1 0 5h0a2.5 2.5 0 0 1 0-5"/><line x1="12" y1="1.5" x2="12" y2="22.5"/></svg> },
    { key: "competition" as const, label: tSettings("notifications.categories.competitions.label"), desc: tSettings("notifications.categories.competitions.desc"), checked: competitionEnabled, set: setCompetitionEnabled, icon: <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> },
  ] as const;

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{tSettings("notifications.title")}</p>
          <p className="text-sm text-muted-foreground">
            {tSettings("notifications.description", { orgName })}
          </p>
        </div>
        <Badge variant="muted">{orgName}</Badge>
      </div>

      <div className="max-w-md space-y-4">
        <Input
          label={tSettings("notifications.email")}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setPrefSuccess(null);
          }}
          placeholder={tSettings("notifications.emailPlaceholder")}
        />

        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="font-medium text-sm text-foreground">{tSettings("notifications.emailNotifications")}</span>
            <p className="text-xs text-muted-foreground">{tSettings("notifications.emailToggleDesc")}</p>
          </div>
          <ToggleSwitch
            checked={emailEnabled}
            onChange={(v) => {
              setEmailEnabled(v);
              setPrefSuccess(null);
            }}
          />
        </div>

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            emailEnabled ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-0">
            <p className="text-xs font-medium text-muted-foreground mb-3">{tSettings("notifications.chooseEmails")}</p>
            {toggleItems.map((item, i) => (
              <div
                key={item.key}
                className={`flex items-center justify-between gap-3 py-3 ${
                  i < toggleItems.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.icon}
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
                <ToggleSwitch
                  size="sm"
                  checked={item.checked}
                  onChange={(v) => {
                    item.set(v);
                    setPrefSuccess(null);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {prefSuccess && <div className="text-sm text-green-600 dark:text-green-400">{prefSuccess}</div>}
      {prefError && <div className="text-sm text-red-600 dark:text-red-400">{prefError}</div>}

      <div className="flex justify-end pt-1">
        <Button onClick={handlePreferenceSave} isLoading={prefSaving}>
          {tSettings("notifications.savePreferences")}
        </Button>
      </div>
    </Card>
  );
}
