import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui";
import { Badge } from "@/components/ui";
import type { EnterpriseRole } from "@/types/enterprise";

/** Only render next/image for hostnames configured in next.config.mjs remotePatterns. */
function isAllowedImageHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const allowed = [
      "lh3.googleusercontent.com",
      "avatars.githubusercontent.com",
      "rytsziwekhtjdqzzpdso.supabase.co",
      "media.licdn.com",
    ];
    return allowed.includes(hostname);
  } catch {
    return false;
  }
}

interface EnterpriseCardProps {
  name: string;
  slug: string;
  logoUrl?: string | null;
  role: EnterpriseRole;
  subOrgCount: number;
  alumniCount: number;
  adminCount?: number;
  memberCount?: number;
}

function getRoleBadgeVariant(role: EnterpriseRole): "primary" | "success" | "warning" | "muted" {
  switch (role) {
    case "owner":
      return "primary";
    case "billing_admin":
      return "success";
    case "org_admin":
      return "warning";
    default:
      return "muted";
  }
}

function getRoleLabel(role: EnterpriseRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "billing_admin":
      return "Billing Admin";
    case "org_admin":
      return "Org Admin";
    default:
      return role;
  }
}

export function EnterpriseCard({
  name,
  slug,
  logoUrl,
  role,
  subOrgCount,
  alumniCount,
  adminCount = 0,
  memberCount = 0,
}: EnterpriseCardProps) {
  return (
    <Link href={`/enterprise/${slug}`}>
      <Card interactive className="h-full">
        <div className="flex items-center gap-4">
          {logoUrl && isAllowedImageHost(logoUrl) ? (
            <div className="relative h-14 w-14 rounded-xl overflow-hidden flex-shrink-0">
              <Image
                src={logoUrl}
                alt={name}
                fill
                className="object-cover"
                sizes="56px"
              />
            </div>
          ) : (
            <div className="h-14 w-14 rounded-xl flex items-center justify-center bg-purple-600 text-white font-bold text-2xl flex-shrink-0">
              {name.charAt(0)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold text-foreground truncate">{name}</h3>
              <Badge variant={getRoleBadgeVariant(role)} className="flex-shrink-0">
                {getRoleLabel(role)}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5" title="Organizations">
                <BuildingIcon className="h-4 w-4" />
                <span>{subOrgCount}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5" title="Admins">
                <ShieldIcon className="h-4 w-4" />
                <span>{adminCount}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5" title="Members">
                <UsersIcon className="h-4 w-4" />
                <span>{memberCount.toLocaleString()}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5" title="Alumni">
                <GraduationCapIcon className="h-4 w-4" />
                <span>{alumniCount.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <ChevronRightIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        </div>
      </Card>
    </Link>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function GraduationCapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
      />
    </svg>
  );
}
