"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Badge } from "@/components/ui";

interface ChatGroupCardProps {
  group: {
    id: string;
    name: string;
    description: string | null;
    is_default: boolean;
    require_approval: boolean;
  };
  orgSlug: string;
  memberCount: number;
  pendingCount: number;
  isAdmin: boolean;
}

export function ChatGroupCard({ group, orgSlug, memberCount, pendingCount, isAdmin }: ChatGroupCardProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    setIsDeleting(true);
    
    // Soft delete the group
    const { error } = await supabase
      .from("chat_groups")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", group.id);

    if (error) {
      console.error("Failed to delete group:", error);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    } else {
      router.refresh();
    }
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  return (
    <Link href={`/${orgSlug}/chat/${group.id}`}>
      <Card className="p-4 hover:border-[var(--color-org-secondary)] transition-colors cursor-pointer h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground truncate">{group.name}</h3>
              {group.is_default && (
                <Badge variant="primary">Default</Badge>
              )}
            </div>
            {group.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {group.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {memberCount} member{memberCount !== 1 ? "s" : ""}
              {group.require_approval && " | Approval required"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {pendingCount > 0 && (
              <Badge variant="warning">{pendingCount} pending</Badge>
            )}
            {!showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={handleDelete}
                    className="h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                    title="Delete group"
                  >
                    <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                )}
                <div className="h-8 w-8 rounded-lg bg-[var(--color-org-secondary)]/20 flex items-center justify-center">
                  <svg className="h-4 w-4 text-[var(--color-org-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={cancelDelete}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-red-500 hover:bg-red-600 text-white"
                >
                  {isDeleting ? "..." : "Delete"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
