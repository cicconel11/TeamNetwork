"use client";

import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { ShareFormLink } from "@/components/forms/ShareFormLink";
import { relativeTime } from "@/lib/utils/relative-time";
import type { Form } from "@/types/database";

interface FormAdminCardProps {
  form: Form;
  orgSlug: string;
  submissionCount: number;
  lastSubmittedAt: string | null;
  onToggleActive: (formId: string, isActive: boolean) => void;
  onDelete: (formId: string) => void;
}

export function FormAdminCard({
  form,
  orgSlug,
  submissionCount,
  lastSubmittedAt,
  onToggleActive,
  onDelete,
}: FormAdminCardProps) {
  return (
    <Card padding="none" className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground truncate">{form.title}</h3>
            <Badge variant={form.is_active ? "success" : "muted"}>
              {form.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
          {form.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
              {form.description}
            </p>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{(form.fields as unknown[])?.length || 0} fields</span>
            <span>
              {submissionCount} submission{submissionCount !== 1 ? "s" : ""}
            </span>
            {lastSubmittedAt && (
              <span>Last submitted {relativeTime(lastSubmittedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleActive(form.id, !form.is_active)}
            title={form.is_active ? "Deactivate" : "Activate"}
          >
            {form.is_active ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </Button>
          <ShareFormLink formUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/${orgSlug}/forms/${form.id}`} />
          <Link href={`/${orgSlug}/forms/admin/${form.id}`}>
            <Button variant="ghost" size="sm" title="View submissions">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </Button>
          </Link>
          <Link href={`/${orgSlug}/forms/admin/${form.id}/edit`}>
            <Button variant="ghost" size="sm" title="Edit form">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Are you sure you want to delete this form?")) {
                onDelete(form.id);
              }
            }}
            title="Delete form"
          >
            <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </Button>
        </div>
      </div>
    </Card>
  );
}
