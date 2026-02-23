import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui";
import { Badge } from "@/components/ui";
import type { EnterpriseRole } from "@/types/enterprise";

interface EnterpriseCardProps {
  name: string;
  slug: string;
  logoUrl?: string | null;
  role: EnterpriseRole;
  subOrgCount: number;
  alumniCount: number;
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
}: EnterpriseCardProps) {
  return (
    <Link href={`/enterprise/${slug}`}>
      <Card interactive className="h-full">
        <div className="flex items-start gap-4">
          {logoUrl ? (
            <div className="relative h-12 w-12 rounded-xl overflow-hidden flex-shrink-0">
              <Image
                src={logoUrl}
                alt={name}
                fill
                className="object-cover"
                sizes="48px"
              />
            </div>
          ) : (
            <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-purple-600 text-white font-bold text-xl flex-shrink-0">
              {name.charAt(0)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-foreground truncate">{name}</h3>
              <Badge variant={getRoleBadgeVariant(role)} className="flex-shrink-0">
                {getRoleLabel(role)}
              </Badge>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <BuildingIcon className="h-4 w-4" />
                <span>{subOrgCount} {subOrgCount === 1 ? "org" : "orgs"}</span>
              </div>
              <div className="flex items-center gap-1">
                <UsersIcon className="h-4 w-4" />
                <span>{alumniCount.toLocaleString()} alumni</span>
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
