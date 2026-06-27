import Link from "next/link";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";

interface PeopleYouShouldMeetWidgetProps {
  orgSlug: string;
}

/**
 * Compact dashboard entry-point for the connections feature. The full
 * /[orgSlug]/connections page is the primary surface and does the scoring work;
 * this card is a low-cost teaser that links into it, so it intentionally fetches
 * no data.
 */
export async function PeopleYouShouldMeetWidget({ orgSlug }: PeopleYouShouldMeetWidgetProps) {
  const t = await getTranslations("pages.feed");

  return (
    <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {t("connectionsTitle")}
      </h3>
      <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
        <Users className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("connectionsBody")}</span>
      </div>
      <Link
        href={`/${orgSlug}/connections`}
        className="mt-3 flex items-center gap-1 border-t border-border/40 pt-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        {t("connectionsCta")} <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
