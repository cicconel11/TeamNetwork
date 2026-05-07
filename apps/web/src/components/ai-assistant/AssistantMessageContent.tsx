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
            className="break-all text-org-secondary underline underline-offset-2 hover:text-org-secondary-dark"
            target={typeof props.href === "string" && /^https?:\/\//i.test(props.href) ? "_blank" : undefined}
            rel={typeof props.href === "string" && /^https?:\/\//i.test(props.href) ? "noreferrer noopener" : undefined}
          />
        ),
        p: (props) => <p {...props} className="mb-2.5 last:mb-0 leading-[1.65] text-foreground/85" />,
        h1: (props) => <h1 {...props} className="mb-3 mt-5 first:mt-0 text-base font-semibold text-foreground" />,
        h2: (props) => <h2 {...props} className="mb-2.5 mt-4 first:mt-0 text-[15px] font-semibold text-foreground" />,
        h3: (props) => <h3 {...props} className="mb-2 mt-3.5 first:mt-0 text-sm font-medium text-foreground" />,
        strong: (props) => <strong {...props} className="font-semibold text-foreground/95" />,
        em: (props) => <em {...props} className="italic text-foreground/75" />,
        ul: (props) => <ul {...props} className="mb-3 ml-4 list-outside list-disc space-y-1 text-foreground/85 marker:text-muted-foreground/50" />,
        ol: (props) => <ol {...props} className="mb-3 ml-4 list-outside list-decimal space-y-1 text-foreground/85 marker:text-muted-foreground/50" />,
        li: (props) => <li {...props} className="leading-[1.6] pl-0.5" />,
        blockquote: (props) => (
          <blockquote
            {...props}
            className="my-2 border-l-2 border-org-secondary/50 pl-3 italic text-muted-foreground"
          />
        ),
        hr: () => <hr className="my-4 border-border" />,
        pre: (props) => (
          <pre
            {...props}
            className="my-3 overflow-x-auto rounded-xl border border-border bg-muted/50 p-3 text-xs"
          />
        ),
        code: ({ inline, className, children, ...props }: MarkdownCodeProps) =>
          inline ? (
            <code
              {...props}
              className={`rounded-md bg-muted px-1.5 py-0.5 text-[0.875em] font-mono text-foreground ${className ?? ""}`.trim()}
            >
              {children}
            </code>
          ) : (
            <code {...props} className={`font-mono text-xs ${className ?? ""}`.trim()}>
              {children}
            </code>
          ),
        table: (props) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table {...props} className="w-full border-collapse text-sm" />
          </div>
        ),
        thead: (props) => (
          <thead {...props} className="border-b border-border bg-muted/50" />
        ),
        tbody: (props) => <tbody {...props} />,
        tr: (props) => (
          <tr {...props} className="border-b border-border/50 last:border-0" />
        ),
        th: (props) => (
          <th {...props} className="px-3 py-2 text-left text-xs font-semibold text-foreground" />
        ),
        td: (props) => (
          <td {...props} className="px-3 py-2 text-foreground" />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
