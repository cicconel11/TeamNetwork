"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./Button";
import { createClient } from "@/lib/supabase/client";

interface SoftDeleteButtonProps {
  table: string;
  id: string;
  redirectTo?: string;
  organizationField?: string;
  organizationId?: string;
  label?: string;
  confirmMessage?: string;
  onAfterDelete?: () => Promise<void>;
  itemName?: string;
}

export function SoftDeleteButton({
  table,
  id,
  redirectTo,
  organizationField,
  organizationId,
  label = "Delete",
  confirmMessage = "Are you sure? This will remove the record from active lists.",
  onAfterDelete,
  itemName,
}: SoftDeleteButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!window.confirm(confirmMessage)) return;
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    let query = supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (organizationField && organizationId) {
      query = query.eq(organizationField, organizationId);
    }

    const { error } = await query;
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    // Call optional post-delete callback (e.g., for calendar sync)
    if (onAfterDelete) {
      try {
        await onAfterDelete();
      } catch (callbackError) {
        // Log but don't block - post-delete actions should not prevent navigation
        console.error("Post-delete callback error:", callbackError);
      }
    }

    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="danger"
        onClick={handleDelete}
        isLoading={isLoading}
        aria-label={itemName ? `Delete ${itemName}` : undefined}
      >
        {label}
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}


