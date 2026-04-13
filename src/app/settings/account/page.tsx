"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui";

type DeletionStatus = "none" | "pending" | "completed";

interface DeletionInfo {
  status: DeletionStatus;
  requestedAt: string | null;
  scheduledDeletionAt: string | null;
}

export default function AccountPage() {
  const [deletionInfo, setDeletionInfo] = useState<DeletionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchDeletionStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/delete-account");
      if (res.ok) {
        const data = await res.json();
        setDeletionInfo(data);
      }
    } catch {
      // Fail silently — page still renders
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDeletionStatus();
  }, [fetchDeletionStatus]);

  const handleDelete = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/user/delete-account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.details || data.error || "Failed to request deletion");
        return;
      }

      setSuccess(
        `Account deletion scheduled for ${new Date(data.scheduledDeletionAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. You will be signed out.`
      );
      setConfirmation("");
      await fetchDeletionStatus();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/user/delete-account", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to cancel deletion");
        return;
      }

      setSuccess("Account deletion has been cancelled.");
      await fetchDeletionStatus();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Account</h1>
        <p className="text-muted-foreground">
          Manage your account settings and data.
        </p>
      </div>

      {/* Data Export */}
      <Card className="p-5 space-y-3">
        <p className="font-medium text-foreground">Export Your Data</p>
        <p className="text-sm text-muted-foreground">
          Download a copy of all your data stored on TeamNetwork, including
          memberships, messages, posts, and more.
        </p>
        <a
          href="/api/user/export-data"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Download My Data
        </a>
      </Card>

      {/* Delete Account */}
      <Card className="p-5 space-y-4 border-red-500/30">
        <p className="font-medium text-red-400">Delete Account</p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : deletionInfo?.status === "pending" ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4">
              <p className="text-sm text-yellow-300 font-medium">
                Deletion Pending
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Your account is scheduled for deletion on{" "}
                <span className="text-foreground font-medium">
                  {deletionInfo.scheduledDeletionAt
                    ? new Date(deletionInfo.scheduledDeletionAt).toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "a future date"}
                </span>
                . You can cancel this request before that date.
              </p>
            </div>
            <button
              onClick={handleCancel}
              disabled={submitting}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {submitting ? "Cancelling..." : "Cancel Deletion Request"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Permanently delete your account and all associated data. This
              action has a 30-day grace period during which you can cancel.
              After that, all your data will be permanently removed.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Note:</strong> You must
              transfer admin roles or delete your organizations before deleting
              your account.
            </p>
            <div className="space-y-2">
              <label
                htmlFor="delete-confirmation"
                className="block text-sm font-medium text-muted-foreground"
              >
                Type <span className="text-red-400 font-mono">DELETE MY ACCOUNT</span> to
                confirm
              </label>
              <input
                id="delete-confirmation"
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <button
              onClick={handleDelete}
              disabled={submitting || confirmation !== "DELETE MY ACCOUNT"}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Processing..." : "Delete My Account"}
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3">
            <p className="text-sm text-green-400">{success}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
