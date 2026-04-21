"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

interface BatchOrgUpgradeBlockerProps {
  enterpriseSlug: string;
  currentCount: number;
  maxAllowed: number;
}

export function BatchOrgUpgradeBlocker({
  enterpriseSlug,
  currentCount,
  maxAllowed,
}: BatchOrgUpgradeBlockerProps) {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center space-y-3">
      <div className="text-amber-600 dark:text-amber-400">
        <svg className="h-10 w-10 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-white">
        Organization Limit Reached
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        You&apos;re using {currentCount} of {maxAllowed} organizations.
        Upgrade your subscription to create more.
      </p>
      <Link href={`/enterprise/${enterpriseSlug}/billing`}>
        <Button variant="primary" className="mt-2">
          Upgrade Plan
        </Button>
      </Link>
    </div>
  );
}
