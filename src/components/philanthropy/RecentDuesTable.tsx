import { Badge } from "@/components/ui";
import type { OrganizationDonation } from "@/types/database";

interface RecentDuesTableProps {
  donations: OrganizationDonation[];
  isAdmin: boolean;
  isPublicView?: boolean;
}

export function RecentDuesTable({ donations, isAdmin, isPublicView = false }: RecentDuesTableProps) {
  const visibleDonations = isPublicView
    ? donations.filter((d) => d.visibility !== "private")
    : donations;

  if (visibleDonations.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No donations recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-dense">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left">Donor</th>
            <th className="text-left">Purpose</th>
            <th className="text-left">Date</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Status</th>
            {isAdmin && !isPublicView && <th className="text-right">Visibility</th>}
          </tr>
        </thead>
        <tbody>
          {visibleDonations.map((donation) => {
            const isAnonymous = donation.anonymous === true;
            const visibility = donation.visibility || "public";

            return (
              <tr key={donation.id}>
                <td>
                  <p className="font-medium text-foreground">
                    {isAnonymous ? "Anonymous" : (donation.donor_name || "Anonymous")}
                  </p>
                  {!isAnonymous && !isPublicView && donation.donor_email && (
                    <p className="text-xs text-muted-foreground">{donation.donor_email}</p>
                  )}
                </td>
                <td className="text-muted-foreground">
                  {donation.purpose || "General support"}
                </td>
                <td className="text-muted-foreground">
                  {donation.created_at
                    ? new Date(donation.created_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="text-right font-mono tabular-nums font-medium text-foreground">
                  ${(donation.amount_cents / 100).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="text-right">
                  <Badge variant={donation.status === "succeeded" ? "success" : donation.status === "failed" ? "error" : "muted"}>
                    {donation.status}
                  </Badge>
                </td>
                {isAdmin && !isPublicView && (
                  <td className="text-right">
                    <VisibilityBadge visibility={visibility} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  switch (visibility) {
    case "supporter_only":
      return (
        <Badge variant="warning">
          <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
          </svg>
          Supporter Only
        </Badge>
      );
    case "private":
      return (
        <Badge variant="muted">
          <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Private
        </Badge>
      );
    default:
      return <span className="text-xs text-muted-foreground">Public</span>;
  }
}
