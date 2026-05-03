"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import { Button } from "./Button";
import { ConfirmationDialog, type ConfirmationDialogCopy } from "./ConfirmationDialog";
import { useMutationAction, type MutationActionOptions } from "@/lib/client/use-mutation-action";

interface ConfirmActionButtonProps<TResult> extends Omit<ComponentProps<typeof Button>, "onClick" | "isLoading"> {
  confirmation: ConfirmationDialogCopy;
  action: () => Promise<TResult>;
  successMessage?: MutationActionOptions<[], TResult>["successMessage"];
  errorMessage?: MutationActionOptions<[], TResult>["errorMessage"];
  onSuccess?: MutationActionOptions<[], TResult>["onSuccess"];
  onError?: MutationActionOptions<[], TResult>["onError"];
}

export function ConfirmActionButton<TResult>({
  confirmation,
  action,
  successMessage,
  errorMessage,
  onSuccess,
  onError,
  children,
  disabled,
  variant,
  ...buttonProps
}: ConfirmActionButtonProps<TResult>) {
  const [open, setOpen] = useState(false);
  const mutation = useMutationAction({
    action,
    successMessage,
    errorMessage,
    onSuccess: async (result) => {
      setOpen(false);
      await onSuccess?.(result);
    },
    onError,
  });

  return (
    <>
      <Button
        {...buttonProps}
        variant={variant ?? (confirmation.destructive ? "danger" : "primary")}
        disabled={disabled || mutation.isPending}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <ConfirmationDialog
        {...confirmation}
        open={open}
        onOpenChange={setOpen}
        isPending={mutation.isPending}
        onConfirm={() => {
          void mutation.run();
        }}
      />
    </>
  );
}
