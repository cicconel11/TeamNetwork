"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select } from "@/components/ui";
import type { EmbedType } from "@/types/database";

export interface Embed {
  id: string;
  organization_id: string;
  title: string;
  url: string;
  embed_type: EmbedType;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface EmbedsManagerProps {
  orgId: string;
  embeds: Embed[];
  tableName: "org_philanthropy_embeds" | "org_donation_embeds";
  title?: string;
  description?: string;
}

export function EmbedsManager({
  orgId,
  embeds: initialEmbeds,
  tableName,
  title = "Fundraising Embeds",
  description = "Add external fundraising pages or embeddable content",
}: EmbedsManagerProps) {
  const router = useRouter();
  const [embeds, setEmbeds] = useState<Embed[]>(initialEmbeds);
  const [showForm, setShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    url: "",
    embed_type: "link" as EmbedType,
  });

  const resetForm = () => {
    setFormData({ title: "", url: "", embed_type: "link" });
    setShowForm(false);
    setEditingId(null);
    setError(null);
  };

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateUrl(formData.url)) {
      setError("URL must be a valid https:// URL");
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    if (editingId) {
      const { error: updateError } = await supabase
        .from(tableName)
        .update({
          title: formData.title,
          url: formData.url,
          embed_type: formData.embed_type,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setIsLoading(false);
        return;
      }

      setEmbeds((prev) =>
        prev.map((e) =>
          e.id === editingId
            ? { ...e, title: formData.title, url: formData.url, embed_type: formData.embed_type }
            : e
        )
      );
    } else {
      const maxOrder = Math.max(0, ...embeds.map((e) => e.display_order));
      const { data, error: insertError } = await supabase
        .from(tableName)
        .insert({
          organization_id: orgId,
          title: formData.title,
          url: formData.url,
          embed_type: formData.embed_type,
          display_order: maxOrder + 1,
        })
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
        setIsLoading(false);
        return;
      }

      if (data) {
        setEmbeds((prev) => [...prev, data as Embed]);
      }
    }

    setIsLoading(false);
    resetForm();
    router.refresh();
  };

  const handleEdit = (embed: Embed) => {
    setFormData({
      title: embed.title,
      url: embed.url,
      embed_type: embed.embed_type,
    });
    setEditingId(embed.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this embed?")) return;

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setEmbeds((prev) => prev.filter((e) => e.id !== id));
    router.refresh();
  };

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <svg
              className="h-4 w-4 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Embed
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 rounded-xl bg-muted/50">
          <Input
            label="Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., GoFundMe Campaign"
            required
          />
          <Input
            label="URL"
            type="url"
            value={formData.url}
            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
            placeholder="https://www.gofundme.com/..."
            helperText="Must be a secure https:// URL"
            required
          />
          <Select
            label="Display Type"
            value={formData.embed_type}
            onChange={(e) =>
              setFormData({ ...formData, embed_type: e.target.value as EmbedType })
            }
            options={[
              { value: "link", label: "Link (opens in new tab)" },
              { value: "iframe", label: "Embed (inline iframe)" },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" isLoading={isLoading}>
              {editingId ? "Update" : "Add"} Embed
            </Button>
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {embeds.length > 0 ? (
        <div className="space-y-3">
          {embeds.map((embed) => (
            <div
              key={embed.id}
              className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{embed.title}</p>
                <p className="text-sm text-muted-foreground truncate">{embed.url}</p>
                <span className="text-xs text-muted-foreground">
                  {embed.embed_type === "iframe" ? "Embedded" : "External Link"}
                </span>
              </div>
              <div className="flex gap-2 ml-4">
                <Button variant="ghost" size="sm" onClick={() => handleEdit(embed)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => handleDelete(embed.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !showForm && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No embeds added yet. Click &quot;Add Embed&quot; to get started.
          </p>
        )
      )}
    </Card>
  );
}







