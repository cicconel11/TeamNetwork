"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import { newWorkoutSchema, type NewWorkoutForm } from "@/lib/schemas/content";
import type { NavConfig } from "@/lib/navigation/nav-items";

type TargetUser = { id: string; label: string };

export default function NewWorkoutPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewWorkoutForm>({
    resolver: zodResolver(newWorkoutSchema),
    defaultValues: {
      title: "",
      description: "",
      workout_date: "",
      external_url: "",
      audience: "both",
      send_notification: true,
      channel: "email",
    },
  });

  const audience = watch("audience");

  // Get the custom label for this page (singular form for action buttons)
  const singularLabel = resolveActionLabel("/workouts", navConfig, "").trim();

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;
      setOrgId(org.id);
      
      // Parse nav_config
      if (org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)) {
        setNavConfig(org.nav_config as NavConfig);
      }

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

  const onSubmit = async (data: NewWorkoutForm) => {
    setIsLoading(true);
    setError(null);

    if (data.audience === "specific" && targetUserIds.length === 0) {
      setError("Select at least one recipient for this notification.");
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const orgIdToUse = orgId
      ? orgId
      : (await supabase.from("organizations").select("id").eq("slug", orgSlug).maybeSingle()).data?.id;

    if (!orgIdToUse) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const audienceValue = data.audience === "specific" ? "both" : data.audience;
    const targetIds = data.audience === "specific" ? targetUserIds : null;

    const { error: insertError, data: workout } = await supabase.from("workouts").insert({
      organization_id: orgIdToUse,
      title: data.title,
      description: data.description || null,
      workout_date: data.workout_date ? data.workout_date : null,
      external_url: data.external_url || null,
      created_by: user?.id || null,
    }).select().single();

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    if (data.send_notification && workout) {
      const workoutDateLine = data.workout_date ? `${singularLabel} date: ${data.workout_date}` : "";
      const notificationBody = [data.description || "", workoutDateLine, data.external_url ? `Link: ${data.external_url}` : ""]
        .filter(Boolean)
        .join("\n\n");

      try {
        await fetch("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgIdToUse,
            title: `New ${singularLabel}: ${data.title}`,
            body: notificationBody || `${singularLabel} posted for ${data.workout_date || "the team"}`,
            channel: data.channel,
            audience: audienceValue,
            targetUserIds: targetIds,
            category: "workout",
          }),
        });
      } catch (notifError) {
        console.error(`Failed to send ${singularLabel.toLowerCase()} notification:`, notifError);
      }
    }

    router.push(`/${orgSlug}/workouts`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Post ${singularLabel}`}
        description={`Create a new ${singularLabel.toLowerCase()} for the team`}
        backHref={`/${orgSlug}/workouts`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Title"
            error={errors.title?.message}
            {...register("title")}
          />

          <Textarea
            label="Description"
            rows={3}
            error={errors.description?.message}
            {...register("description")}
          />

          <Input
            label="Date"
            type="date"
            error={errors.workout_date?.message}
            {...register("workout_date")}
          />

          <Input
            label={`External ${singularLabel.toLowerCase()} link (optional)`}
            type="url"
            placeholder={`https://example.com/${singularLabel.toLowerCase()}`}
            helperText="Must be https://"
            error={errors.external_url?.message}
            {...register("external_url")}
          />

          <Select
            label="Audience"
            error={errors.audience?.message}
            options={[
              { label: "Members + Alumni", value: "both" },
              { label: "Members only", value: "members" },
              { label: "Alumni only", value: "alumni" },
              { label: "Specific individuals", value: "specific" },
            ]}
            {...register("audience")}
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

          <Select
            label="Notification Channel"
            error={errors.channel?.message}
            options={[
              { label: "Email", value: "email" },
              { label: "SMS", value: "sms" },
              { label: "Email + SMS", value: "both" },
            ]}
            {...register("channel")}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="send_notification"
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
              {...register("send_notification")}
            />
            <label htmlFor="send_notification" className="text-sm text-foreground">
              Send email or text notification to selected audience
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Post {singularLabel}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
