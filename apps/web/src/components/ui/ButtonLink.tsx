"use client";

import Link, { LinkProps } from "next/link";
import { forwardRef, ReactNode } from "react";
import { buttonVariants, type ButtonVariant, type ButtonSize } from "./Button";

interface ButtonLinkProps extends LinkProps {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ children, className = "", variant = "primary", size = "md", ...props }, ref) => {
    return (
      <Link
        ref={ref}
        className={`${buttonVariants(variant, size)} ${className}`}
        {...props}
      >
        {children}
      </Link>
    );
  }
);
ButtonLink.displayName = "ButtonLink";