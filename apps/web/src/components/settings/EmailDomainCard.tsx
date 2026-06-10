"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input } from "@/components/ui";

interface EmailDomainCardProps {
  orgId: string;
  orgName: string;
}

interface DnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: number;
  status: string;
}

interface EmailDomainState {
  domain: string;
  status: string;
  dnsRecords: DnsRecord[];
  senderLocalPart: string;
  senderDisplayName: string | null;
  senderPreview: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
}

type BadgeVariant = "error" | "success" | "primary" | "muted" | "warning";

function statusBadgeVariant(status: string): BadgeVariant {
  if (status === "verified") return "success";
  if (status === "failed" || status === "partially_failed") return "error";
  return "warning";
}

export function EmailDomainCard({ orgId, orgName }: EmailDomainCardProps) {
  const tCustom = useTranslations("customization");

  const [loading, setLoading] = useState(true);
  const [emailDomain, setEmailDomain] = useState<EmailDomainState | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/email-domain`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || tCustom("emailDomain.loadError"));
      }
      setEmailDomain(data?.emailDomain ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCustom("emailDomain.loadError"));
    } finally {
      setLoading(false);
    }
  }, [orgId, tCustom]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/email-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domainInput,
          senderDisplayName: displayNameInput || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || tCustom("emailDomain.genericError"));
      }
      setEmailDomain(data?.emailDomain ?? null);
      setDomainInput("");
      setDisplayNameInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tCustom("emailDomain.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/email-domain/verify`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || tCustom("emailDomain.genericError"));
      }
      setEmailDomain(data?.emailDomain ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCustom("emailDomain.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(tCustom("emailDomain.removeConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/email-domain`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || tCustom("emailDomain.genericError"));
      }
      setEmailDomain(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCustom("emailDomain.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 2000);
    } catch {
      // Clipboard unavailable (insecure context) — leave value selectable in the table.
    }
  };

  const statusLabel = (status: string) => {
    if (status === "verified") return tCustom("emailDomain.statusVerified");
    if (status === "failed" || status === "partially_failed") return tCustom("emailDomain.statusFailed");
    return tCustom("emailDomain.statusPending");
  };

  const senderPreview = emailDomain
    ? `${emailDomain.senderDisplayName || orgName} <${emailDomain.senderPreview}>`
    : "";

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{tCustom("emailDomain.title")}</p>
          <p className="text-sm text-muted-foreground">{tCustom("emailDomain.description")}</p>
        </div>
        {emailDomain && (
          <Badge variant={statusBadgeVariant(emailDomain.status)}>
            {statusLabel(emailDomain.status)}
          </Badge>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : !emailDomain ? (
        <div className="space-y-3">
          <Input
            label={tCustom("emailDomain.domainLabel")}
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder={tCustom("emailDomain.domainPlaceholder")}
            disabled={busy}
          />
          <Input
            label={tCustom("emailDomain.displayNameLabel")}
            type="text"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder={orgName}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button onClick={handleConnect} isLoading={busy} disabled={!domainInput.trim()}>
              {tCustom("emailDomain.connect")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground font-medium">{emailDomain.domain}</p>

          {emailDomain.status === "verified" ? (
            <p className="text-sm text-muted-foreground">
              {tCustom("emailDomain.verifiedNote", { sender: senderPreview })}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{tCustom("emailDomain.dnsInstructions")}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">{tCustom("emailDomain.dnsType")}</th>
                      <th className="py-1.5 pr-3 font-medium">{tCustom("emailDomain.dnsName")}</th>
                      <th className="py-1.5 pr-3 font-medium">{tCustom("emailDomain.dnsValue")}</th>
                      <th className="py-1.5 pr-3 font-medium">{tCustom("emailDomain.dnsPriority")}</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {emailDomain.dnsRecords.map((record, index) => (
                      <tr key={`${record.record}-${record.name}-${index}`} className="border-t border-border align-top">
                        <td className="py-2 pr-3 font-mono">{record.type}</td>
                        <td className="py-2 pr-3 font-mono break-all">{record.name}</td>
                        <td className="py-2 pr-3 font-mono break-all max-w-[200px]">{record.value}</td>
                        <td className="py-2 pr-3 font-mono">{record.priority ?? "—"}</td>
                        <td className="py-2 text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCopy(record.value)}
                          >
                            {copiedValue === record.value
                              ? tCustom("emailDomain.copied")
                              : tCustom("emailDomain.copy")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{tCustom("emailDomain.dmarcNote")}</p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {emailDomain.status !== "verified" && (
              <Button onClick={handleVerify} isLoading={busy} variant="secondary">
                {tCustom("emailDomain.checkVerification")}
              </Button>
            )}
            <Button onClick={handleRemove} disabled={busy} variant="secondary">
              {tCustom("emailDomain.remove")}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
    </Card>
  );
}
