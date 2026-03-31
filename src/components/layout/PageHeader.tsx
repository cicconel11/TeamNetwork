"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserContent } from "@/components/i18n/UserContent";

interface PageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  actions?: ReactNode;
  translateTitle?: boolean;
  translateDescription?: boolean;
}

export function PageHeader({
  title,
  description,
  backHref,
  actions,
  translateTitle = false,
  translateDescription = false,
}: PageHeaderProps) {
  const t = useTranslations("common");
  return (
    <div className="mb-8">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {t("back")}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          {translateTitle ? (
            <UserContent as="h1" className="text-2xl font-bold text-foreground">
              {title}
            </UserContent>
          ) : (
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          )}
          {description && (
            translateDescription ? (
              <UserContent as="p" className="mt-1 text-muted-foreground">
                {description}
              </UserContent>
            ) : (
              <p className="mt-1 text-muted-foreground">{description}</p>
            )
          )}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
