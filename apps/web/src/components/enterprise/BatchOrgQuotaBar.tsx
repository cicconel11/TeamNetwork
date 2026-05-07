"use client";

interface BatchOrgQuotaBarProps {
  currentCount: number;
  maxAllowed: number | null;
  adding: number;
}

export function BatchOrgQuotaBar({ currentCount, maxAllowed, adding }: BatchOrgQuotaBarProps) {
  if (maxAllowed == null) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Currently using {currentCount} organizations (unlimited plan)
      </div>
    );
  }

  const wouldUse = currentCount + adding;
  const remaining = Math.max(maxAllowed - currentCount, 0);
  const percentage = Math.min((wouldUse / maxAllowed) * 100, 100);
  const isOverLimit = wouldUse > maxAllowed;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300">
          Using {currentCount} of {maxAllowed} organizations
          {adding > 0 && (
            <span className={isOverLimit ? "text-red-600 dark:text-red-400 font-medium" : "text-blue-600 dark:text-blue-400"}>
              {" "}(+{adding} new = {wouldUse})
            </span>
          )}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {remaining} remaining
        </span>
      </div>
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOverLimit
              ? "bg-red-500"
              : percentage > 80
              ? "bg-amber-500"
              : "bg-blue-500"
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      {isOverLimit && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Exceeds your limit by {wouldUse - maxAllowed}. Remove organizations or upgrade your plan.
        </p>
      )}
    </div>
  );
}
