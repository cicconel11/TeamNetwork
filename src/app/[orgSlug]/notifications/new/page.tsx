"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Input, Card, Textarea, Select } from "@/components/ui";

export default function NewNotificationPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  // Fetch org and recipient count
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // Get org
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (org) {
        setOrgId(org.id);

        // Get count of users with notification preferences for this org
        const { count } = await supabase
          .from("notification_preferences")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id);

        setRecipientCount(count || 0);
      }
    };

    fetchData();
  }, [orgSlug]);

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

    // Get recipients based on channel
    const { data: preferences } = await supabase
      .from("notification_preferences")
      .select("user_id, email_enabled, sms_enabled, email_address, phone_number")
      .eq("organization_id", orgId);

    if (!preferences || preferences.length === 0) {
      setError("No recipients have notification preferences set up for this organization.");
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
      })
      .select()
      .single();

    if (notifError) {
      setError(notifError.message);
      setIsLoading(false);
      return;
    }

    // In a real implementation, we would call an API route or edge function
    // to send the actual notifications. For now, we just mark it as sent.
    // The sendNotificationBlast function from lib/notifications.ts would be called server-side.

    // Mark notification as sent
    await supabase
      .from("notifications")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", notification.id);

    // Simulate sending delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Success - redirect back to notifications list
    router.push(`/${orgSlug}/notifications`);
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
              { value: "sms", label: "SMS only" },
              { value: "both", label: "Email and SMS" },
            ]}
          />

          {recipientCount !== null && (
            <div className="p-4 rounded-xl bg-muted/50 text-sm">
              <p className="text-muted-foreground">
                <strong className="text-foreground">{recipientCount}</strong> member(s) have notification preferences for this organization.
                {recipientCount === 0 && (
                  <span className="block mt-1 text-amber-600 dark:text-amber-400">
                    Members need to set up their notification preferences before they can receive blasts.
                  </span>
                )}
              </p>
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
              disabled={recipientCount === 0}
            >
              Send Notification
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

