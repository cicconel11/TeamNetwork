"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Input, Card, Textarea, Select } from "@/components/ui";
import type { Database } from "@/types/database";
import { sendNotificationBlast, buildNotificationTargets } from "@/lib/notifications";

export default function NewNotificationPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  type NotificationAudience = Database["public"]["Tables"]["notifications"]["Row"]["audience"];
  const [audience, setAudience] = useState<NotificationAudience>("both");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    total: number;
    emailCount: number;
    smsCount: number;
    skippedMissingContact: number;
  } | null>(null);

  // Fetch org and preview target counts
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];

      if (org && !orgError) {
        setOrgId(org.id);
        const { stats } = await buildNotificationTargets({
          supabase,
          organizationId: org.id,
          audience,
          channel,
        });
        setPreview(stats);
      }
    };

    fetchData();
  }, [orgSlug, audience, channel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be logged in");
      setIsLoading(false);
      return;
    }

    // Create the notification record
    const { data: notification, error: notifError } = await supabase
      .from("notifications")
      .insert({
        organization_id: orgId,
        created_by_user_id: user.id,
        title,
        body,
        channel,
        audience,
      })
      .select()
      .single();

    if (notifError) {
      setError(notifError.message);
      setIsLoading(false);
      return;
    }

    const blastResult = await sendNotificationBlast({
      supabase,
      organizationId: orgId,
      audience,
      channel,
      title,
      body,
    });

    // Mark notification as sent (blast would occur server-side in production)
    await supabase
      .from("notifications")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", notification.id);

    // Simulate sending delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Success - redirect back to notifications list
    router.push(`/${orgSlug}/notifications?sent=${blastResult.total}`);
  };

  return (
    <div>
      <PageHeader
        title="Send Notification"
        description="Send an email or SMS blast to organization members"
        backHref={`/${orgSlug}/notifications`}
      />

      <Card className="max-w-2xl p-6">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Subject / Title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Important announcement..."
            required
          />

          <Textarea
            label="Message Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Enter your message here..."
            rows={6}
            required
          />

          <Select
            label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as "email" | "sms" | "both")}
            options={[
              { value: "email", label: "Email only" },
              { value: "sms", label: "SMS only (requires phone in preferences)" },
              { value: "both", label: "Email and SMS" },
            ]}
          />

          <Select
            label="Audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as NotificationAudience)}
            options={[
              { value: "members", label: "Members" },
              { value: "alumni", label: "Alumni" },
              { value: "both", label: "Both" },
            ]}
          />

          {preview && (
            <div className="p-4 rounded-xl bg-muted/50 text-sm space-y-1">
              <p className="text-foreground font-semibold">Recipient preview</p>
              <p className="text-muted-foreground">
                Total targets: <strong className="text-foreground">{preview.total}</strong>
              </p>
              <p className="text-muted-foreground">
                Via email: <strong className="text-foreground">{preview.emailCount}</strong> • Via SMS:{" "}
                <strong className="text-foreground">{preview.smsCount}</strong>
              </p>
              {preview.skippedMissingContact > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  Skipped {preview.skippedMissingContact} missing contact info or disabled channel.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-4 pt-4">
            <Link href={`/${orgSlug}/notifications`} className="flex-1">
              <Button type="button" variant="secondary" className="w-full">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              className="flex-1"
              isLoading={isLoading}
              disabled={!preview || preview.total === 0}
            >
              Send Notification
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

