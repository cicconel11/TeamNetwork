import type { ReactNode } from "react";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<Size, string> = {
  sm: "max-w-3xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
};

interface ContainerProps {
  size?: Size;
  as?: "div" | "section";
  className?: string;
  children: ReactNode;
}

export function Container({
  size = "xl",
  as: Tag = "div",
  className = "",
  children,
}: ContainerProps) {
  return (
    <Tag className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${SIZE_MAP[size]} ${className}`.trim()}>
      {children}
    </Tag>
  );
}
