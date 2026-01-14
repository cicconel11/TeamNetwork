"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface DeleteAlumniButtonProps {
  organizationId: string;
  alumniId: string;
  redirectTo: string;
}

export function DeleteAlumniButton({
  organizationId,
  alumniId,
  redirectTo,
}: DeleteAlumniButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!window.confirm("Are you sure? This will remove the alumni from active lists.")) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/organizations/${organizationId}/alumni/${alumniId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload.code === "ORG_READ_ONLY") {
          setError("This organization is in its billing grace period. Existing alumni cannot be deleted until billing is restored.");
        } else {
          setError(payload.error || "Unable to delete alumni");
        }
        setIsLoading(false);
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Unable to delete alumni");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="danger" onClick={handleDelete} isLoading={isLoading}>
        Delete
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
