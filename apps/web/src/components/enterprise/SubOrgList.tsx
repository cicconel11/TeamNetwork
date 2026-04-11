"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, Badge, EmptyState } from "@/components/ui";
import type { EnterpriseRelationshipType, SubOrgBillingType } from "@/types/enterprise";

interface SubOrg {
  id: string;
  name: string;
  slug: string;
  alumniCount: number;
  parentsCount: number;
  relationshipType: EnterpriseRelationshipType;
  billingType: SubOrgBillingType;
}

interface SubOrgListProps {
  orgs: SubOrg[];
  enterpriseSlug: string;
}

export function SubOrgList({ orgs, enterpriseSlug }: SubOrgListProps) {
  const tEnterprise = useTranslations("enterprise");
  const tCommon = useTranslations("common");

  if (orgs.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BuildingIcon className="h-12 w-12" />}
          title={tEnterprise("subOrgList.noOrgs")}
          description={tEnterprise("subOrgList.noOrgsDesc")}
        />
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tEnterprise("subOrgList.organization")}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tEnterprise("subOrgList.slug")}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tCommon("role") === "Role" ? "Alumni" : tCommon("role")}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tCommon("role") === "Role" ? "Parents" : tCommon("role")}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tEnterprise("subOrgList.relationship")}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              {tEnterprise("subOrgList.billing")}
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
              {tCommon("actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} className="border-b border-border last:border-0 hover:bg-muted/50">
              <td className="py-4 px-4">
                <span className="font-medium text-foreground">{org.name}</span>
              </td>
              <td className="py-4 px-4">
                <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
                  {org.slug}
                </code>
              </td>
              <td className="py-4 px-4">
                <span className="text-sm text-foreground">{org.alumniCount.toLocaleString()}</span>
              </td>
              <td className="py-4 px-4">
                <span className="text-sm text-foreground">{org.parentsCount.toLocaleString()}</span>
              </td>
              <td className="py-4 px-4">
                <Badge variant={org.relationshipType === "created" ? "primary" : "success"}>
                  {org.relationshipType === "created" ? tEnterprise("subOrgList.created") : tEnterprise("subOrgList.adopted")}
                </Badge>
              </td>
              <td className="py-4 px-4">
                <Badge variant={org.billingType === "enterprise_managed" ? "muted" : "warning"}>
                  {org.billingType === "enterprise_managed" ? tEnterprise("subOrgList.enterpriseBilling") : tEnterprise("subOrgList.independent")}
                </Badge>
              </td>
              <td className="py-4 px-4 text-right">
                <Link
                  href={`/enterprise/${enterpriseSlug}/invites?org=${org.id}`}
                  className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {tEnterprise("subOrgList.invite")}
                </Link>
                <span className="mx-2 text-muted-foreground">|</span>
                <Link
                  href={`/${org.slug}`}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  {tEnterprise("subOrgList.viewDashboard")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
