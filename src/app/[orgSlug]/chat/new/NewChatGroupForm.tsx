"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Avatar, Badge } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface NewChatGroupFormProps {
  orgSlug: string;
  organizationId: string;
  currentUserId: string;
}

interface OrgMember {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
}

export function NewChatGroupForm({ orgSlug, organizationId, currentUserId }: NewChatGroupFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<OrgMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    is_default: false,
    require_approval: false,
  });

  // Load organization members
  useEffect(() => {
    async function loadMembers() {
      setIsLoadingMembers(true);
      const { data } = await supabase
        .from("members")
        .select("id, user_id, first_name, last_name, email, photo_url, role")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("last_name");

      if (data) {
        // Filter out members without user_id (not linked to auth)
        setOrgMembers(data.filter(m => m.user_id) as OrgMember[]);
      }
      setIsLoadingMembers(false);
    }
    loadMembers();
  }, [supabase, organizationId]);

  // Filter members based on search
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return orgMembers;
    const query = searchQuery.toLowerCase();
    return orgMembers.filter(m => 
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(query) ||
      m.email?.toLowerCase().includes(query) ||
      m.role?.toLowerCase().includes(query)
    );
  }, [orgMembers, searchQuery]);

  // Members not yet selected
  const availableMembers = useMemo(() => {
    const selectedIds = new Set(selectedMembers.map(m => m.id));
    return filteredMembers.filter(m => !selectedIds.has(m.id));
  }, [filteredMembers, selectedMembers]);

  const toggleMember = (member: OrgMember) => {
    setSelectedMembers(prev => {
      const exists = prev.some(m => m.id === member.id);
      if (exists) {
        return prev.filter(m => m.id !== member.id);
      }
      return [...prev, member];
    });
  };

  const removeMember = (memberId: string) => {
    setSelectedMembers(prev => prev.filter(m => m.id !== memberId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError("Group name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Create the group
    const { data: group, error: createError } = await supabase
      .from("chat_groups")
      .insert({
        organization_id: organizationId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        is_default: formData.is_default,
        require_approval: formData.require_approval,
        created_by: currentUserId,
      })
      .select()
      .single();

    if (createError || !group) {
      setError(createError?.message || "Failed to create group");
      setIsSubmitting(false);
      return;
    }

    // Add the creator as an admin member
    const memberInserts: Array<{
      chat_group_id: string;
      user_id: string;
      organization_id: string;
      role: "admin" | "moderator" | "member";
      added_by: string;
    }> = [
      {
        chat_group_id: group.id,
        user_id: currentUserId,
        organization_id: organizationId,
        role: "admin",
        added_by: currentUserId,
      },
    ];

    // Add selected members
    for (const member of selectedMembers) {
      if (member.user_id !== currentUserId) {
        memberInserts.push({
          chat_group_id: group.id,
          user_id: member.user_id,
          organization_id: organizationId,
          role: "member",
          added_by: currentUserId,
        });
      }
    }

    const { error: membersError } = await supabase
      .from("chat_group_members")
      .insert(memberInserts);

    if (membersError) {
      console.error("Failed to add members:", membersError);
      // Don't redirect if we couldn't add members - the user won't be able to see the group
      setError("Failed to add members to the group. Please try again.");
      setIsSubmitting(false);
      return;
    }

    // Use window.location for a hard navigation to ensure fresh data
    window.location.href = `/${orgSlug}/chat/${group.id}`;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="New Chat Group"
        description="Create a new group for your organization to communicate"
      />

      <Card className="p-6 mt-4 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Group Name *</label>
            <Input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., General, Coaches, Parents"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What is this group for?"
              rows={3}
            />
          </div>

          {/* Member Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Add Members {selectedMembers.length > 0 && `(${selectedMembers.length} selected)`}
            </label>
            
            {/* Selected members */}
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedMembers.map(member => (
                  <Badge
                    key={member.id}
                    variant="primary"
                    className="flex items-center gap-1 pr-1"
                  >
                    {member.first_name} {member.last_name}
                    <button
                      type="button"
                      onClick={() => removeMember(member.id)}
                      className="ml-1 hover:bg-white/20 rounded p-0.5"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Search input */}
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members by name, email, or role..."
              className="mb-2"
            />

            {/* Member list */}
            <div className="border border-border rounded-lg max-h-60 overflow-y-auto">
              {isLoadingMembers ? (
                <div className="p-4 text-center text-muted-foreground">
                  Loading members...
                </div>
              ) : availableMembers.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  {searchQuery ? "No members match your search" : "No more members to add"}
                </div>
              ) : (
                availableMembers.map(member => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0 text-left"
                  >
                    <Avatar
                      src={member.photo_url || undefined}
                      name={`${member.first_name} ${member.last_name}`}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {member.first_name} {member.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.role || member.email || "Member"}
                      </p>
                    </div>
                    <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </button>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              You will be added as an admin automatically. Only selected members will be able to view this group.
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <div>
                <span className="font-medium">Default group</span>
                <p className="text-sm text-muted-foreground">
                  New members will automatically be added to this group
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.require_approval}
                onChange={(e) => setFormData({ ...formData, require_approval: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <div>
                <span className="font-medium">Require message approval</span>
                <p className="text-sm text-muted-foreground">
                  Messages from regular members must be approved by moderators before being visible
                </p>
              </div>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Group"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/${orgSlug}/chat`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
