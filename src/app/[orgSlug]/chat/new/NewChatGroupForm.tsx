"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface NewChatGroupFormProps {
  orgSlug: string;
  organizationId: string;
  currentUserId: string;
}

export function NewChatGroupForm({ orgSlug, organizationId, currentUserId }: NewChatGroupFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    is_default: false,
    require_approval: false,
  });

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
    await supabase.from("chat_group_members").insert({
      chat_group_id: group.id,
      user_id: currentUserId,
      organization_id: organizationId,
      role: "admin",
    });

    router.push(`/${orgSlug}/chat/${group.id}`);
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
