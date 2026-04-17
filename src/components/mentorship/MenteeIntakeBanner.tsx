"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

interface MenteeIntakeBannerProps {
  orgSlug: string;
  intakeFormId: string | null;
}

export function MenteeIntakeBanner({ orgSlug, intakeFormId }: MenteeIntakeBannerProps) {
  const t = useTranslations("mentorship");
  if (!intakeFormId) return null;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          {t("intakeBannerTitle")}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {t("intakeBannerDesc")}
        </p>
      </div>
      <Link href={`/${orgSlug}/forms/${intakeFormId}`}>
        <Button size="sm">{t("intakeBannerCta")}</Button>
      </Link>
    </div>
  );
}
