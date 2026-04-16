import { Badge } from "@/components/ui";
import type { OrganizationDonation } from "@/types/database";

interface RecentDuesTableTranslations {
  noDonationsYet: string;
  donor: string;
  purpose: string;
  date: string;
  amount: string;
  status: string;
  visibility: string;
  anonymous: string;
  generalSupport: string;
  visibilitySupporterOnly: string;
  visibilityPrivate: string;
}

interface RecentDuesTableProps {
  donations: OrganizationDonation[];
  isAdmin: boolean;
  isPublicView?: boolean;
  translations: RecentDuesTableTranslations;
}

export function RecentDuesTable({ donations, isAdmin, isPublicView = false, translations: t }: RecentDuesTableProps) {
  const SETTLED_STATUSES = ["succeeded", "recorded"];
  const visibleDonations = isPublicView
    ? donations.filter((d) => (d.visibility || "public") === "public" && SETTLED_STATUSES.includes(d.status))
    : donations;

  if (visibleDonations.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t.noDonationsYet}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-dense">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left">{t.donor}</th>
            <th className="text-left">{t.purpose}</th>
            <th className="text-left">{t.date}</th>
            <th className="text-right">{t.amount}</th>
            <th className="text-right">{t.status}</th>
            {isAdmin && !isPublicView && <th className="text-right">{t.visibility}</th>}
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
                    {isAnonymous ? t.anonymous : (donation.donor_name || t.anonymous)}
                  </p>
                  {!isAnonymous && !isPublicView && donation.donor_email && (
                    <p className="text-xs text-muted-foreground">{donation.donor_email}</p>
                  )}
                </td>
                <td className="text-muted-foreground">
                  {donation.purpose || t.generalSupport}
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
                  <Badge
                    variant={donation.status === "succeeded" ? "success" : donation.status === "failed" ? "error" : "muted"}
                    className={donation.status === "succeeded" ? "badge-success-muted" : ""}
                  >
                    {donation.status}
                  </Badge>
                </td>
                {isAdmin && !isPublicView && (
                  <td className="text-right">
                    <VisibilityBadge visibility={visibility} translations={t} />
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

function VisibilityBadge({ visibility, translations: t }: { visibility: string; translations: Pick<RecentDuesTableTranslations, "visibilitySupporterOnly" | "visibilityPrivate"> }) {
  switch (visibility) {
    case "supporter_only":
      return (
        <Badge variant="warning">
          <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
          </svg>
          {t.visibilitySupporterOnly}
        </Badge>
      );
    case "private":
      return (
        <Badge variant="muted">
          <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {t.visibilityPrivate}
        </Badge>
      );
    default:
      return (
        <span className="inline-flex items-center justify-end text-muted-foreground" title="Public">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        </span>
      );
  }
}
