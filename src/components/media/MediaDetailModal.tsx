"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Button, Badge, Input } from "@/components/ui";
import type { MediaItem } from "./MediaCard";

interface MediaDetailModalProps {
  item: MediaItem;
  isAdmin: boolean;
  currentUserId?: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: { title?: string; description?: string; tags?: string[] }) => void;
  onModerate?: (id: string, action: "approve" | "reject", rejectionReason?: string) => void;
}

export function MediaDetailModal({
  item,
  isAdmin,
  currentUserId,
  onClose,
  onDelete,
  onUpdate,
  onModerate,
}: MediaDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description || "");
  const [editTags, setEditTags] = useState(item.tags.join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const isUploader = item.uploaded_by === currentUserId;
  const canEdit = isAdmin || isUploader;
  const displayUrl = item.url || item.external_url;
  const uploaderName = item.users?.name || "Unknown";

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleSave = async () => {
    setSaving(true);
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdate(item.id, {
      title: editTitle,
      description: editDescription || undefined,
      tags,
    });
    setSaving(false);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete(item.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Content */}
      <div
        className="relative z-10 w-full max-w-5xl max-h-[90vh] mx-4 bg-card rounded-2xl border border-border shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
        >
          <svg className="w-4 h-4 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="md:grid md:grid-cols-[2fr_1fr] max-h-[90vh]">
          {/* Media panel */}
          <div className="relative bg-black/5 dark:bg-black/20 flex items-center justify-center min-h-[300px] md:min-h-[500px]">
            {item.media_type === "video" && displayUrl ? (
              <video
                src={displayUrl}
                controls
                className="max-h-[70vh] max-w-full"
                autoPlay={false}
              />
            ) : displayUrl ? (
              <Image
                src={displayUrl}
                alt={item.title}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 66vw"
              />
            ) : (
              <div className="text-muted-foreground">
                <svg className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M2.25 18.75h19.5a2.25 2.25 0 0 0 2.25-2.25V7.5a2.25 2.25 0 0 0-2.25-2.25H2.25A2.25 2.25 0 0 0 0 7.5v9a2.25 2.25 0 0 0 2.25 2.25Zm4.5-10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
                </svg>
              </div>
            )}
          </div>

          {/* Metadata panel */}
          <div className="p-6 overflow-y-auto max-h-[90vh] space-y-5 border-l border-border">
            {isEditing ? (
              <>
                <Input
                  label="Title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={200}
                />
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Description</label>
                  <textarea
                    className="input min-h-[80px]"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={2000}
                  />
                </div>
                <Input
                  label="Tags (comma-separated)"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="event, team, 2024"
                />
                <div className="flex gap-2">
                  <Button onClick={handleSave} isLoading={saving} size="sm">
                    Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
                  {item.status !== "approved" && (
                    <Badge variant={item.status === "pending" ? "warning" : "muted"} className="mt-1">
                      {item.status}
                    </Badge>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Uploaded by</span>
                    <p className="text-foreground">{uploaderName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date</span>
                    <p className="text-foreground">
                      {item.taken_at
                        ? new Date(item.taken_at).toLocaleDateString()
                        : new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {item.description && (
                    <div>
                      <span className="text-muted-foreground">Description</span>
                      <p className="text-foreground whitespace-pre-wrap">{item.description}</p>
                    </div>
                  )}
                  {item.tags.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Tags</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="muted">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Moderation actions for admins */}
                {isAdmin && item.status === "pending" && onModerate && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground mr-auto">Pending review</span>
                      <Button
                        size="sm"
                        onClick={() => onModerate(item.id, "approve")}
                      >
                        Approve
                      </Button>
                      {!showRejectForm && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowRejectForm(true)}
                        >
                          Reject
                        </Button>
                      )}
                    </div>
                    {showRejectForm && (
                      <div className="space-y-2">
                        <textarea
                          className="input min-h-[60px] text-sm w-full"
                          placeholder="Reason for rejection (required)"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          maxLength={1000}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={!rejectionReason.trim()}
                            onClick={() => onModerate(item.id, "reject", rejectionReason.trim())}
                          >
                            Confirm Reject
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowRejectForm(false); setRejectionReason(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  {displayUrl && (
                    <a
                      href={displayUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-muted text-foreground hover:bg-border transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download
                    </a>
                  )}
                  {canEdit && (
                    <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                      Edit
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      variant={confirmDelete ? "danger" : "ghost"}
                      size="sm"
                      onClick={handleDelete}
                    >
                      {confirmDelete ? "Confirm delete" : "Delete"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
