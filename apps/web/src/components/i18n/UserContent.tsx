import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type UserContentProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  lang?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "lang" | "translate">;

export function UserContent<T extends ElementType = "span">({
  as,
  children,
  lang,
  ...props
}: UserContentProps<T>) {
  const Component = (as ?? "span") as ElementType;

  return (
    <Component translate="yes" lang={lang ?? "und"} data-user-content {...props}>
      {children}
    </Component>
  );
}
