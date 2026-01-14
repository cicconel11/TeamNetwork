"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";

interface MenteeStatusToggleProps {
  orgId: string;
}

export function MenteeStatusToggle({ orgId }: MenteeStatusToggleProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "revoked" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to manage your mentee availability.");
        setLoading(false);
        return;
      }
      setUserId(user.id);

      const { data: membership, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      if (!membership || membership.role !== "active_member") {
        setError("Only active members can change mentee availability.");
        setLoading(false);
        return;
      }

      setStatus((membership.status as "active" | "revoked") ?? "active");
      setLoading(false);
    };

    load();
  }, [orgId]);

  const toggle = async () => {
    if (!status || !userId) {
      setError("Unable to update availability right now.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const nextStatus = status === "active" ? "revoked" : "active";
    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: nextStatus })
      .eq("organization_id", orgId)
      .eq("user_id", userId || "");

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setStatus(nextStatus as "active" | "revoked");
    setSaving(false);
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="animate-spin h-5 w-5 border-4 border-org-primary border-t-transparent rounded-full" />
          Checking availability...
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-foreground">Mentee availability</h3>
        <p className="text-sm text-muted-foreground">
          Toggle whether you are available as an active member mentee. Turning off removes you from mentee selection.
        </p>
      </div>

      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">
          {status === "active" ? "Currently available" : "Currently not available"}
        </span>
        <Button onClick={toggle} isLoading={saving} variant={status === "active" ? "ghost" : "primary"}>
          {status === "active" ? "Turn off" : "Turn on"}
        </Button>
      </div>
    </Card>
  );
}
