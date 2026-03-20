"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";

interface AssistantMessageContentProps {
  content: string;
}

export function AssistantMessageContent({ content }: AssistantMessageContentProps) {
  type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
    inline?: boolean;
    node?: unknown;
  };

  return (
    <ReactMarkdown
      components={{
        a: ({ node: _node, ...props }) => (
          <a
            {...props}
            className="break-all text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
            target="_blank"
            rel="noreferrer noopener"
          />
        ),
        p: ({ node: _node, ...props }) => <p {...props} className="my-0 leading-relaxed" />,
        ul: ({ node: _node, ...props }) => <ul {...props} className="ml-5 list-disc space-y-1" />,
        ol: ({ node: _node, ...props }) => <ol {...props} className="ml-5 list-decimal space-y-1" />,
        li: ({ node: _node, ...props }) => <li {...props} className="break-words" />,
        pre: ({ node: _node, ...props }) => (
          <pre
            {...props}
            className="my-2 overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-xs"
          />
        ),
        code: ({ node: _node, inline, className, children, ...props }: MarkdownCodeProps) =>
          inline ? (
            <code
              {...props}
              className={`rounded bg-background/80 px-1 py-0.5 text-[0.9em] ${className ?? ""}`.trim()}
            >
              {children}
            </code>
          ) : (
            <code {...props} className={`text-xs ${className ?? ""}`.trim()}>
              {children}
            </code>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
