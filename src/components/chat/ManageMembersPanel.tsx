"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Badge, Button, Input } from "@/components/ui";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  removed_at: string | null;
  users: {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

interface OrgMember {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
}

interface ManageMembersPanelProps {
  orgSlug: string;
  organizationId: string;
  groupId: string;
  currentUserId: string;
  isCreator: boolean;
  canManage: boolean;
  onClose: () => void;
  onMembersChanged: () => void;
}

export function ManageMembersPanel({
  orgSlug,
  organizationId,
  groupId,
  currentUserId,
  isCreator,
  canManage,
  onClose,
  onMembersChanged,
}: ManageMembersPanelProps) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOrg, setIsLoadingOrg] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddSection, setShowAddSection] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const loadMembers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("chat_group_members")
      .select(`
        id, user_id, role, joined_at, removed_at,
        users:user_id (id, name, email, avatar_url)
      `)
      .eq("chat_group_id", groupId)
      .is("removed_at", null);

    if (queryError) {
      console.error("[chat-members] loadMembers failed:", queryError);
      setError(queryError.message);
    } else if (data) {
      setMembers(data as unknown as MemberRow[]);
    }
    setIsLoading(false);
  }, [supabase, groupId]);

  const loadOrgMembers = useCallback(async () => {
    setIsLoadingOrg(true);
    const { data } = await supabase
      .from("members")
      .select("id, user_id, first_name, last_name, email, photo_url")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("last_name");

    if (data) {
      setOrgMembers(data.filter(m => m.user_id) as OrgMember[]);
    }
    setIsLoadingOrg(false);
  }, [supabase, organizationId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (showAddSection && orgMembers.length === 0) {
      loadOrgMembers();
    }
  }, [showAddSection, orgMembers.length, loadOrgMembers]);

  const memberUserIds = useMemo(
    () => new Set(members.map(m => m.user_id)),
    [members]
  );

  const availableMembers = useMemo(() => {
    const filtered = orgMembers.filter(m => !memberUserIds.has(m.user_id));
    if (!searchQuery.trim()) return filtered;
    const query = searchQuery.toLowerCase();
    return filtered.filter(m =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(query) ||
      m.email?.toLowerCase().includes(query)
    );
  }, [orgMembers, memberUserIds, searchQuery]);

  const handleAddMember = async (userId: string) => {
    setActionInProgress(userId);
    setError(null);

    // Try INSERT first; on unique violation, UPDATE to clear removed_at
    const { error: insertError } = await supabase
      .from("chat_group_members")
      .insert({
        chat_group_id: groupId,
        user_id: userId,
        organization_id: organizationId,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        // Unique violation — re-add by clearing removed_at
        const { error: updateError } = await supabase
          .from("chat_group_members")
          .update({ removed_at: null })
          .eq("chat_group_id", groupId)
          .eq("user_id", userId);

        if (updateError) {
          console.error("[chat-members] re-add failed:", updateError);
          trackBehavioralEvent("chat_participants_change", {
            thread_id: groupId,
            action: "add",
            delta_count: 1,
            result: "fail_server",
          }, organizationId);
          setError("Failed to re-add member");
          setActionInProgress(null);
          return;
        }
      } else {
        console.error("[chat-members] add member failed:", insertError);
        trackBehavioralEvent("chat_participants_change", {
          thread_id: groupId,
          action: "add",
          delta_count: 1,
          result: "fail_server",
        }, organizationId);
        setError(insertError.message || "Failed to add member");
        setActionInProgress(null);
        return;
      }
    }

    await loadMembers();
    trackBehavioralEvent("chat_participants_change", {
      thread_id: groupId,
      action: "add",
      delta_count: 1,
      result: "success",
    }, organizationId);
    onMembersChanged();
    setActionInProgress(null);
  };

  const handleRemoveMember = async (userId: string) => {
    const isSelf = userId === currentUserId;
    if (isSelf && !confirm("Are you sure you want to leave this group?")) return;
    if (!isSelf && !confirm("Remove this member from the group?")) return;

    setActionInProgress(userId);
    setError(null);

    const { error: updateError } = await supabase
      .from("chat_group_members")
      .update({ removed_at: new Date().toISOString() })
      .eq("chat_group_id", groupId)
      .eq("user_id", userId);

    if (updateError) {
      trackBehavioralEvent("chat_participants_change", {
        thread_id: groupId,
        action: "remove",
        delta_count: 1,
        result: "fail_server",
      }, organizationId);
      setError("Failed to remove member");
      setActionInProgress(null);
      return;
    }

    if (isSelf) {
      trackBehavioralEvent("chat_participants_change", {
        thread_id: groupId,
        action: "remove",
        delta_count: 1,
        result: "success",
      }, organizationId);
      // Redirect to chat list after leaving
      router.push(`/${orgSlug}/chat`);
      return;
    }

    await loadMembers();
    trackBehavioralEvent("chat_participants_change", {
      thread_id: groupId,
      action: "remove",
      delta_count: 1,
      result: "success",
    }, organizationId);
    onMembersChanged();
    setActionInProgress(null);
  };

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "primary" as const;
      case "moderator": return "warning" as const;
      default: return "muted" as const;
    }
  };

  return (
    <div className="border-l border-border w-80 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold">Members ({members.length})</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2 rounded bg-red-500/10 text-red-500 text-xs">
          {error}
        </div>
      )}

      {/* Members list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm py-4">Loading...</div>
        ) : (
          members.map(member => {
            const isSelf = member.user_id === currentUserId;
            const isGroupCreator = isCreator && member.user_id === currentUserId;
            const displayName = member.users?.name || member.users?.email || "Unknown";
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
              >
                <Avatar
                  src={member.users?.avatar_url || undefined}
                  name={displayName}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <Badge variant={roleBadgeVariant(member.role)} className="text-[10px]">
                    {member.role}
                  </Badge>
                </div>
                {isSelf && !isGroupCreator ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRemoveMember(member.user_id)}
                    disabled={actionInProgress === member.user_id}
                    className="text-xs"
                  >
                    Leave
                  </Button>
                ) : !isSelf && canManage ? (
                  <button
                    onClick={() => handleRemoveMember(member.user_id)}
                    disabled={actionInProgress === member.user_id}
                    className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Add members section */}
      {canManage && (
        <div className="border-t border-border">
          {!showAddSection ? (
            <button
              onClick={() => setShowAddSection(true)}
              className="w-full p-3 text-sm text-[var(--color-org-secondary)] hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Members
            </button>
          ) : (
            <div className="p-3 space-y-2">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search members..."
                className="text-sm"
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {isLoadingOrg ? (
                  <div className="text-center text-muted-foreground text-xs py-2">Loading...</div>
                ) : availableMembers.length === 0 ? (
                  <div className="text-center text-muted-foreground text-xs py-2">
                    {searchQuery ? "No matches" : "No more members to add"}
                  </div>
                ) : (
                  availableMembers.map(member => (
                    <button
                      key={member.id}
                      onClick={() => handleAddMember(member.user_id)}
                      disabled={actionInProgress === member.user_id}
                      className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                    >
                      <Avatar
                        src={member.photo_url || undefined}
                        name={`${member.first_name} ${member.last_name}`}
                        size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{member.first_name} {member.last_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      </div>
                      <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </button>
                  ))
                )}
              </div>
              <button
                onClick={() => { setShowAddSection(false); setSearchQuery(""); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
