"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
      remarkPlugins={[remarkGfm]}
      components={{
        a: (props) => (
          <a
            {...props}
            className="break-all text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
            target={typeof props.href === "string" && /^https?:\/\//i.test(props.href) ? "_blank" : undefined}
            rel={typeof props.href === "string" && /^https?:\/\//i.test(props.href) ? "noreferrer noopener" : undefined}
          />
        ),
        p: (props) => <p {...props} className="my-0 leading-relaxed" />,
        ul: (props) => <ul {...props} className="ml-5 list-disc space-y-1" />,
        ol: (props) => <ol {...props} className="ml-5 list-decimal space-y-1" />,
        li: (props) => <li {...props} className="break-words" />,
        pre: (props) => (
          <pre
            {...props}
            className="my-2 overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-xs"
          />
        ),
        code: ({ inline, className, children, ...props }: MarkdownCodeProps) =>
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
        table: (props) => (
          <div className="my-2 overflow-x-auto">
            <table {...props} className="w-full border-collapse text-xs" />
          </div>
        ),
        thead: (props) => (
          <thead {...props} className="border-b border-border bg-muted/30" />
        ),
        tbody: (props) => <tbody {...props} />,
        tr: (props) => (
          <tr {...props} className="border-b border-border/50 even:bg-muted/20" />
        ),
        th: (props) => (
          <th {...props} className="px-2 py-1 text-left font-medium text-foreground" />
        ),
        td: (props) => (
          <td {...props} className="px-2 py-1 text-muted-foreground" />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
