import { Resend } from "resend";

/**
 * Thin wrapper over the Resend Domains API used by the org email-domain
 * routes. When RESEND_API_KEY is unset (local dev), a deterministic stub
 * lets the whole connect → DNS records → verify flow run end-to-end:
 * stub domains are created `pending` and flip to `verified` on verify.
 * Production callers must treat `isEmailDomainServiceConfigured() === false`
 * as a 503 — the stub is for local development only.
 */

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export const RESEND_DOMAIN_REGION = "us-east-1";

export type EmailDomainStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "failed"
  | "partially_verified"
  | "partially_failed";

export interface DnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: number;
  status: string;
}

export interface DomainSnapshot {
  id: string;
  name: string;
  status: EmailDomainStatus;
  records: DnsRecord[];
}

const STUB_ID_PREFIX = "stub_dom_";
const stubVerified = new Set<string>();

export function isEmailDomainServiceConfigured(): boolean {
  return resend !== null;
}

export function isStubDomainId(id: string): boolean {
  return id.startsWith(STUB_ID_PREFIX);
}

function stubRecords(domain: string, status: string): DnsRecord[] {
  return [
    {
      record: "SPF",
      type: "MX",
      name: `send.${domain}`,
      value: "feedback-smtp.us-east-1.amazonses.com",
      ttl: "Auto",
      priority: 10,
      status,
    },
    {
      record: "SPF",
      type: "TXT",
      name: `send.${domain}`,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: "Auto",
      status,
    },
    {
      record: "DKIM",
      type: "TXT",
      name: `resend._domainkey.${domain}`,
      value: "p=STUBKEY0000000000000000000000000000000000000000",
      ttl: "Auto",
      status,
    },
  ];
}

function stubSnapshot(id: string, domain: string): DomainSnapshot {
  const verified = stubVerified.has(id);
  const status: EmailDomainStatus = verified ? "verified" : "pending";
  return { id, name: domain, status, records: stubRecords(domain, status) };
}

interface RawRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: number;
  status: string;
}

function normalizeRecords(records: RawRecord[] | undefined): DnsRecord[] {
  return (records ?? []).map((r) => ({
    record: r.record,
    type: r.type,
    name: r.name,
    value: r.value,
    ttl: r.ttl,
    priority: r.priority,
    status: r.status,
  }));
}

export async function createDomain(domain: string): Promise<DomainSnapshot> {
  if (!resend) {
    const id = `${STUB_ID_PREFIX}${domain.replace(/[^a-z0-9]/g, "_")}`;
    stubVerified.delete(id);
    return stubSnapshot(id, domain);
  }
  const { data, error } = await resend.domains.create({
    name: domain,
    region: RESEND_DOMAIN_REGION,
  });
  if (error || !data) {
    throw new Error(error?.message || "Failed to create domain in Resend");
  }
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    records: normalizeRecords(data.records),
  };
}

export async function getDomain(id: string, domain: string): Promise<DomainSnapshot> {
  if (!resend || isStubDomainId(id)) {
    return stubSnapshot(id, domain);
  }
  const { data, error } = await resend.domains.get(id);
  if (error || !data) {
    throw new Error(error?.message || "Failed to fetch domain from Resend");
  }
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    records: normalizeRecords(data.records),
  };
}

export async function verifyDomain(id: string, domain: string): Promise<DomainSnapshot> {
  if (!resend || isStubDomainId(id)) {
    stubVerified.add(id);
    return stubSnapshot(id, domain);
  }
  const { error } = await resend.domains.verify(id);
  if (error) {
    throw new Error(error.message || "Failed to trigger domain verification");
  }
  // verify() only enqueues the check; the refreshed status lives on get().
  return getDomain(id, domain);
}

export async function removeDomain(id: string): Promise<void> {
  if (!resend || isStubDomainId(id)) {
    stubVerified.delete(id);
    return;
  }
  const { error } = await resend.domains.remove(id);
  // A domain already gone from Resend is success for our purposes.
  if (error && !/not[_ ]?found/i.test(error.message ?? "")) {
    throw new Error(error.message || "Failed to remove domain from Resend");
  }
}
