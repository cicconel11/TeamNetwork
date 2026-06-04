"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { getBlockedUserIds, toggleBlock } from "@/lib/moderation";

interface BlockedUser {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

export default function BlockedUsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await getBlockedUserIds();
      if (ids.length === 0) {
        setUsers([]);
        return;
      }
      const { data, error } = await supabase
        .from("users")
        .select("id, name, avatar_url")
        .in("id", ids);
      if (error) throw error;
      setUsers((data ?? []) as BlockedUser[]);
    } catch (err) {
      console.error("[blocked-users] load failed", err);
      toast.error("Could not load your blocked users.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(userId: string) {
    setPendingId(userId);
    try {
      await toggleBlock(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("Unblocked. Their content is visible again.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unblock");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Blocked Users</h1>
        <p className="text-muted-foreground">
          You won&apos;t see content from blocked users, and they won&apos;t see
          yours. Unblock anyone to restore visibility.
        </p>
      </div>

      {loading ? (
        <Card className="p-5 text-sm text-muted-foreground">Loading…</Card>
      ) : users.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="font-medium text-foreground">No blocked users</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When you block someone, they&apos;ll show up here so you can unblock
            them later.
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-3 p-4">
              <Avatar
                src={user.avatar_url || undefined}
                name={user.name || "Unknown user"}
                size="sm"
              />
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                {user.name || "Unknown user"}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isLoading={pendingId === user.id}
                onClick={() => unblock(user.id)}
              >
                Unblock
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
