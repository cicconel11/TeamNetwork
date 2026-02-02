interface AlumniUsageBarProps {
  currentCount: number;
  limit: number | null;
  className?: string;
}

function getUsageColor(percentage: number): string {
  if (percentage >= 90) {
    return "bg-red-500";
  }
  if (percentage >= 70) {
    return "bg-yellow-500";
  }
  return "bg-green-500";
}

function getUsageTextColor(percentage: number): string {
  if (percentage >= 90) {
    return "text-red-600 dark:text-red-400";
  }
  if (percentage >= 70) {
    return "text-yellow-600 dark:text-yellow-400";
  }
  return "text-green-600 dark:text-green-400";
}

export function AlumniUsageBar({ currentCount, limit, className = "" }: AlumniUsageBarProps) {
  const isUnlimited = limit === null;
  const percentage = isUnlimited ? 0 : Math.min((currentCount / limit) * 100, 100);
  const displayPercentage = isUnlimited ? 0 : Math.round(percentage);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground font-medium">Pooled Alumni Usage</span>
        {isUnlimited ? (
          <span className="text-muted-foreground">
            {currentCount.toLocaleString()} alumni <span className="text-purple-600 dark:text-purple-400">(Unlimited)</span>
          </span>
        ) : (
          <span className={getUsageTextColor(percentage)}>
            {currentCount.toLocaleString()} / {limit.toLocaleString()} alumni ({displayPercentage}%)
          </span>
        )}
      </div>

      <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
        {isUnlimited ? (
          <div
            className="h-full bg-purple-500 transition-all duration-300"
            style={{ width: "100%" }}
          />
        ) : (
          <div
            className={`h-full ${getUsageColor(percentage)} transition-all duration-300`}
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>

      {!isUnlimited && percentage >= 90 && (
        <p className="text-xs text-red-600 dark:text-red-400">
          You are approaching your alumni limit. Consider upgrading your tier.
        </p>
      )}
      {!isUnlimited && percentage >= 70 && percentage < 90 && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          You are using {displayPercentage}% of your alumni quota.
        </p>
      )}
    </div>
  );
}
