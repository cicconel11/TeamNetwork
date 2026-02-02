import Link from "next/link";
import { Card, Badge, EmptyState } from "@/components/ui";
import type { EnterpriseRelationshipType } from "@/types/enterprise";

interface SubOrg {
  id: string;
  name: string;
  slug: string;
  alumniCount: number;
  relationshipType: EnterpriseRelationshipType;
}

interface SubOrgListProps {
  orgs: SubOrg[];
  enterpriseSlug: string;
}

export function SubOrgList({ orgs, enterpriseSlug }: SubOrgListProps) {
  if (orgs.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BuildingIcon className="h-12 w-12" />}
          title="No organizations yet"
          description="Create a new organization or adopt an existing one to get started."
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
              Organization
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              Slug
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              Alumni
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
              Relationship
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
              Actions
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
                <Badge variant={org.relationshipType === "created" ? "primary" : "success"}>
                  {org.relationshipType === "created" ? "Created" : "Adopted"}
                </Badge>
              </td>
              <td className="py-4 px-4 text-right">
                <Link
                  href={`/${org.slug}`}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  View Dashboard
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
