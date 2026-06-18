"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

const SIZE = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
} as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Visible heading. If omitted, pass `ariaLabel` so screen readers still get a name. */
  title?: ReactNode;
  /** Accessible name used when no visible `title` is rendered. */
  ariaLabel?: string;
  /** Optional sub-heading rendered under the title. */
  description?: ReactNode;
  size?: keyof typeof SIZE;
  /** Extra classes for the content container. */
  className?: string;
  /**
   * Drop the built-in p-6 padding and title/description chrome. Use for modals
   * that supply their own header (e.g. a bordered header row). The consumer is
   * then responsible for an accessible name via `ariaLabel`.
   */
  noPadding?: boolean;
  /** Hide the top-right close (X) button. Escape + overlay-click still close. */
  hideCloseButton?: boolean;
  "data-testid"?: string;
}

/**
 * The single shared modal shell. Built on Radix Dialog, so focus trapping,
 * Escape-to-close, overlay-click-to-close, and scroll locking come for free.
 * Prefer this over hand-rolled `role="dialog"` + fixed-overlay markup.
 */
export function Modal({
  open,
  onOpenChange,
  children,
  title,
  ariaLabel,
  description,
  size = "md",
  className = "",
  noPadding = false,
  hideCloseButton = false,
  "data-testid": dataTestId,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content
            data-testid={dataTestId}
            className={`relative w-full ${SIZE[size]} max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-border bg-card text-foreground shadow-xl focus:outline-none ${noPadding ? "" : "p-6"} ${className}`}
          >
            {noPadding ? (
              <Dialog.Title className="sr-only">{ariaLabel ?? "Dialog"}</Dialog.Title>
            ) : title ? (
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            ) : (
              <Dialog.Title className="sr-only">{ariaLabel ?? "Dialog"}</Dialog.Title>
            )}
            {!noPadding && description && (
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </Dialog.Description>
            )}
            {!hideCloseButton && (
              <Dialog.Close
                aria-label="Close"
                className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Dialog.Close>
            )}
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
