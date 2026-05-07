"use client";

import { Card } from "@/components/ui";

interface OrgStat {
  name: string;
  count: number;
}

interface AlumniStatsHeaderProps {
  totalCount: number;
  orgStats: OrgStat[];
  topIndustries?: { name: string; count: number }[];
}

export function AlumniStatsHeader({
  totalCount,
  orgStats,
  topIndustries = [],
}: AlumniStatsHeaderProps) {
  const maxOrgCount = Math.max(...orgStats.map((o) => o.count), 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Total Count Card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <UsersIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground font-mono">
              {totalCount.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">Total Alumni</p>
          </div>
        </div>
      </Card>

      {/* Org Breakdown Card */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <BuildingIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">By Organization</h3>
        </div>
        <div className="space-y-2">
          {orgStats.slice(0, 4).map((org) => (
            <div key={org.name} className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 dark:bg-purple-400 rounded-full transition-all"
                  style={{ width: `${(org.count / maxOrgCount) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-16 truncate" title={org.name}>
                {org.name}
              </span>
              <span className="text-xs font-mono text-foreground w-10 text-right">
                {org.count}
              </span>
            </div>
          ))}
          {orgStats.length > 4 && (
            <p className="text-xs text-muted-foreground">+{orgStats.length - 4} more</p>
          )}
        </div>
      </Card>

      {/* Top Industries Card */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <BriefcaseIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Top Industries</h3>
        </div>
        <div className="space-y-1.5">
          {topIndustries.slice(0, 5).map((industry, idx) => (
            <div key={industry.name} className="flex items-center justify-between">
              <span className="text-sm text-foreground truncate" title={industry.name}>
                {idx + 1}. {industry.name}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {industry.count}
              </span>
            </div>
          ))}
          {topIndustries.length === 0 && (
            <p className="text-sm text-muted-foreground">No industry data</p>
          )}
        </div>
      </Card>
    </div>
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

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z"
      />
    </svg>
  );
}
