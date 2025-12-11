 "use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";

type Channel = "email" | "sms" | "both";
type Audience = "members" | "alumni" | "both" | "specific";

type TargetUser = {
  id: string;
  label: string;
};

export default function NewNotificationPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [audience, setAudience] = useState<Audience>("both");
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;
      setOrgId(org.id);

      const { data: memberships } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", org.id)
        .eq("status", "active");

      const options =
        memberships?.map((m) => {
          const user = Array.isArray(m.users) ? m.users[0] : m.users;
          return {
            id: m.user_id,
            label: user?.name || user?.email || "User",
          };
        }) || [];

      setUserOptions(options);
    };

    load();
  }, [orgSlug]);

  const toggleTarget = (id: string) => {
    setTargetUserIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const orgIdToUse = orgId
        ? orgId
        : (await supabase.from("organizations").select("id").eq("slug", orgSlug).maybeSingle()).data?.id;

      if (!orgIdToUse) {
        throw new Error("Organization not found");
      }

      const { error: insertError } = await supabase.from("notifications").insert({
        organization_id: orgIdToUse,
        title,
        body: body || null,
        channel,
        audience: audience === "specific" ? "both" : audience,
        target_user_ids: audience === "specific" ? targetUserIds : null,
        sent_at: null,
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      router.push(`/${orgSlug}/notifications`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Send Notification"
        description="Create and send a notification to your organization"
      />

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Title"
            placeholder="Team meeting tomorrow"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <Textarea
            label="Message"
            placeholder="Add more details for your members..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />

          <Select
            label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            options={[
              { label: "Email", value: "email" },
              { label: "SMS", value: "sms" },
              { label: "Email + SMS", value: "both" },
            ]}
          />

          <Select
            label="Audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            options={[
              { label: "Members + Alumni", value: "both" },
              { label: "Members only", value: "members" },
              { label: "Alumni only", value: "alumni" },
              { label: "Specific individuals", value: "specific" },
            ]}
          />

          {audience === "specific" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Select recipients</p>
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-xl border border-border p-3">
                {userOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No users available</p>
                )}
                {userOptions.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={targetUserIds.includes(user.id)}
                      onChange={() => toggleTarget(user.id)}
                    />
                    <span className="truncate">{user.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Link href={`/${orgSlug}/notifications`} className="flex-1">
              <Button type="button" variant="secondary" className="w-full">
                Cancel
              </Button>
            </Link>
            <Button type="submit" className="flex-1" isLoading={isLoading}>
              Send Notification
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

