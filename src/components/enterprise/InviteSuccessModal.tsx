"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites/QRCodeDisplay";

interface InviteSuccessModalProps {
  invite: {
    code: string;
    token: string;
    organization_name: string | null;
    role: string;
    is_enterprise_wide?: boolean;
  };
  onClose: () => void;
  onCreateAnother: () => void;
}

export function InviteSuccessModal({
  invite,
  onClose,
  onCreateAnother,
}: InviteSuccessModalProps) {
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/app/join?token=${encodeURIComponent(invite.token)}&invite=enterprise`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = inviteUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="p-6">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-3">
          <CheckIcon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Invite Created!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {invite.is_enterprise_wide
            ? "Share this enterprise-wide invite"
            : <>Share this invite for <span className="font-medium">{invite.organization_name}</span></>
          }
        </p>
      </div>

      {/* Invite Code */}
      <div className="mb-6 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Invite Code</p>
        <p className="text-3xl font-mono font-bold text-foreground tracking-widest">
          {invite.code}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Role: <span className="capitalize">{invite.role.replace("_", " ")}</span>
        </p>
      </div>

      {/* QR Code */}
      <div className="flex justify-center mb-6">
        <QRCodeDisplay url={inviteUrl} size={160} />
      </div>

      {/* Copyable Link */}
      <div className="mb-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Invite Link</p>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground truncate"
          />
          <Button variant="secondary" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckIcon className="h-4 w-4" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={onCreateAnother} className="flex-1">
          Create Another
        </Button>
        <Button onClick={onClose} className="flex-1">
          Done
        </Button>
      </div>
    </Card>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
      />
    </svg>
  );
}
