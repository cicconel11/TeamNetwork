"use client";

import Link, { LinkProps } from "next/link";
import { forwardRef, ReactNode } from "react";
import { buttonVariants } from "./Button";

interface ButtonLinkProps extends LinkProps {
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "custom";
  size?: "sm" | "md" | "lg";
  "aria-label"?: string;
  target?: string;
  rel?: string;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ children, className = "", variant = "primary", size = "md", target, rel, "aria-label": ariaLabel, ...props }, ref) => {
    // Add security attributes for external links
    const externalRel = target === "_blank" ? `noopener noreferrer${rel ? ` ${rel}` : ""}` : rel;

    return (
      <Link
        ref={ref}
        className={`${buttonVariants(variant, size)} ${className}`}
        target={target}
        rel={externalRel}
        aria-label={ariaLabel}
        {...props}
      >
        {children}
      </Link>
    );
  }
);
ButtonLink.displayName = "ButtonLink";