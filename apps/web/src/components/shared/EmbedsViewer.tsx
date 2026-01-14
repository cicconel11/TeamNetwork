"use client";

import { Card, EmptyState } from "@/components/ui";
import type { EmbedType } from "@/types/database";

export interface Embed {
  id: string;
  title: string;
  url: string;
  embed_type: EmbedType;
}

interface EmbedsViewerProps {
  embeds: Embed[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EmbedsViewer({
  embeds,
  emptyTitle = "No fundraising links",
  emptyDescription = "There are no external fundraising pages linked yet.",
}: EmbedsViewerProps) {
  if (embeds.length === 0) {
    return (
      <Card className="mb-6">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      {embeds.map((embed) => (
        <Card key={embed.id} className="overflow-hidden">
          {embed.embed_type === "iframe" ? (
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{embed.title}</h3>
            </div>
          ) : null}

          {embed.embed_type === "iframe" ? (
            <div className="relative aspect-video">
              <iframe
                src={embed.url}
                className="w-full h-full border-0"
                title={embed.title}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            </div>
          ) : (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-org-primary/10 flex items-center justify-center">
                  <svg
                    className="h-5 w-5 text-org-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-foreground">{embed.title}</p>
                  <p className="text-sm text-muted-foreground truncate max-w-xs">
                    {embed.url}
                  </p>
                </div>
              </div>
              <svg
                className="h-5 w-5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}







