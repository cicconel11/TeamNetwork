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
  variant?: "default" | "editorial";
}

export function PageHeader({
  title,
  description,
  backHref,
  actions,
  translateTitle = false,
  translateDescription = false,
  variant = "default",
}: PageHeaderProps) {
  const t = useTranslations("common");

  const isEditorial = variant === "editorial";

  const wrapperClass = isEditorial
    ? "mb-8 pb-6 border-b border-border"
    : "mb-8";

  const titleClass = isEditorial
    ? "font-display text-4xl md:text-5xl font-semibold tracking-tight text-foreground"
    : "text-2xl font-bold text-foreground";

  return (
    <div className={wrapperClass}>
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
            <UserContent as="h1" className={titleClass}>
              {title}
            </UserContent>
          ) : (
            <h1 className={titleClass}>{title}</h1>
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
