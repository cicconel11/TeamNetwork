"use client";

import { Card, Button } from "@/components/ui";
import type { PhilanthropyEmbed } from "@/types/database";

interface EmbedViewerProps {
  embeds: PhilanthropyEmbed[];
}

export function EmbedViewer({ embeds }: EmbedViewerProps) {
  if (embeds.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-4">Fundraising Resources</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {embeds.map((embed) => (
          <Card key={embed.id} className="overflow-hidden">
            {embed.embed_type === "iframe" ? (
              <div className="relative">
                <div className="p-4 border-b border-border">
                  <h3 className="font-medium text-foreground">{embed.title}</h3>
                </div>
                <iframe
                  src={embed.url}
                  title={embed.title}
                  className="w-full h-[400px] border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="p-6">
                <h3 className="font-semibold text-foreground mb-2">{embed.title}</h3>
                <p className="text-sm text-muted-foreground mb-4 truncate">{embed.url}</p>
                <a href={embed.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" className="w-full">
                    <svg
                      className="h-4 w-4 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                      />
                    </svg>
                    Visit Page
                  </Button>
                </a>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}







