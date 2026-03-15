"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/notifications", label: "Notifications" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <nav className="mb-6 flex gap-4 border-b border-border">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`pb-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
