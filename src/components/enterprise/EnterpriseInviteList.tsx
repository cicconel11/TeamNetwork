"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites";
import { getRoleBadgeVariant, getRoleLabel } from "@/lib/auth/role-display";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";
import { formatShortDate, isExpired } from "@/lib/utils/dates";

interface Invite {
  id: string;
  enterprise_id: string;
  organization_id: string | null;
  organization_name: string | null;
  code: string;
  token: string;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  is_enterprise_wide?: boolean;
}

interface EnterpriseInviteListProps {
  invites: Invite[];
  onRevoke: (inviteId: string) => void;
  onDelete: (inviteId: string) => void;
  groupByOrg?: boolean;
}

export function EnterpriseInviteList({
  invites,
  onRevoke,
  onDelete,
  groupByOrg = true,
}: EnterpriseInviteListProps) {
  const tEnterprise = useTranslations("enterprise");
  const tCommon = useTranslations("common");
  const [copied, setCopied] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(null), 2000);
  };

  const getInviteLink = (invite: Invite) => {
    return buildInviteLink({
      kind: "enterprise",
      baseUrl: typeof window !== "undefined" ? window.location.origin : "",
      token: invite.token,
      isEnterpriseWide: invite.is_enterprise_wide ?? false,
    });
  };

  const isValid = (invite: Invite) => {
    if (invite.revoked_at) return false;
    if (isExpired(invite.expires_at)) return false;
    if (invite.uses_remaining !== null && invite.uses_remaining <= 0) return false;
    return true;
  };

  if (invites.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<InviteIcon className="h-12 w-12" />}
          title={tEnterprise("inviteList.noInvites")}
          description={tEnterprise("inviteList.noInvitesDesc")}
        />
      </Card>
    );
  }

  // Group invites by organization if enabled
  const groupedInvites = groupByOrg
    ? invites.reduce((acc, invite) => {
        const key = invite.organization_name ?? tEnterprise("inviteList.enterpriseWide");
        if (!acc[key]) acc[key] = [];
        acc[key].push(invite);
        return acc;
      }, {} as Record<string, Invite[]>)
    : { "All Invites": invites };

  return (
    <div className="space-y-6">
      {Object.entries(groupedInvites).map(([orgName, orgInvites]) => (
        <div key={orgName}>
          {groupByOrg && (
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {orgName}
            </h3>
          )}
          <div className="space-y-3">
            {orgInvites.map((invite) => {
              const valid = isValid(invite);
              const expired = isExpired(invite.expires_at);
              const exhausted = invite.uses_remaining !== null && invite.uses_remaining <= 0;
              const revoked = !!invite.revoked_at;
              const inviteLink = getInviteLink(invite);

              return (
                <Card key={invite.id} className={`p-4 ${!valid ? "opacity-60" : ""}`}>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div
                          className="font-mono text-lg font-bold tracking-wider cursor-pointer hover:text-purple-600 transition-colors"
                          onClick={() => copyToClipboard(invite.code, `code-${invite.id}`)}
                          title="Click to copy code"
                        >
                          {invite.code}
                          {copied === `code-${invite.id}` && (
                            <span className="ml-2 text-xs text-emerald-500 font-normal">{tCommon("copied")}</span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant={getRoleBadgeVariant(invite.role)}>
                            {getRoleLabel(invite.role)}
                          </Badge>
                          {!groupByOrg && (
                            <Badge variant="muted" className="text-xs">
                              {invite.organization_name ?? tEnterprise("inviteList.enterpriseWide")}
                            </Badge>
                          )}
                          {expired && <Badge variant="error">{tCommon("expired")}</Badge>}
                          {exhausted && <Badge variant="error">{tCommon("usesLeft", { count: 0 })}</Badge>}
                          {revoked && <Badge variant="error">{tCommon("revoke")}</Badge>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => copyToClipboard(inviteLink, `link-${invite.id}`)}
                        >
                          <LinkIcon className="h-4 w-4 mr-1" />
                          {copied === `link-${invite.id}` ? tCommon("copied") : tCommon("copy")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setShowQR(showQR === invite.id ? null : invite.id)}
                        >
                          <QRIcon className="h-4 w-4" />
                        </Button>
                        {valid && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRevoke(invite.id)}
                            className="text-amber-500 hover:text-amber-600"
                          >
                            {tCommon("revoke")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(invite.id)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>
                        {invite.uses_remaining !== null
                          ? tCommon("usesLeft", { count: invite.uses_remaining })
                          : tCommon("unlimitedUses")}
                      </span>
                      {invite.expires_at && (
                        <span>{tCommon("expired")} {formatShortDate(invite.expires_at)}</span>
                      )}
                      <span>{tCommon("date")} {formatShortDate(invite.created_at)}</span>
                    </div>

                    {showQR === invite.id && (
                      <div className="border-t border-border pt-4 flex justify-center">
                        <QRCodeDisplay url={inviteLink} size={160} />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"
      />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}

function QRIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}
