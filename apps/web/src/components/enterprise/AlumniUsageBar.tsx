import { Button } from "@/components/ui";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import { formatBucketRange } from "@/lib/enterprise/pricing";

interface AlumniUsageBarProps {
  currentCount: number;
  bucketQuantity: number;
  onUpgrade?: () => void;
  isSalesManaged?: boolean;
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

export function AlumniUsageBar({ currentCount, bucketQuantity, onUpgrade, isSalesManaged, className = "" }: AlumniUsageBarProps) {
  const limit = bucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
  const percentage = Math.min((currentCount / limit) * 100, 100);
  const displayPercentage = Math.round(percentage);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground font-medium">Pooled Alumni Usage</span>
        <span className={getUsageTextColor(percentage)}>
          {currentCount.toLocaleString()} / {limit.toLocaleString()} alumni ({displayPercentage}%)
        </span>
      </div>

      <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${getUsageColor(percentage)} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {isSalesManaged
          ? "Sales-managed plan"
          : `Bucket ${bucketQuantity}: ${formatBucketRange(bucketQuantity)} alumni`}
      </div>

      {percentage >= 100 && onUpgrade && !isSalesManaged && (
        <div className="flex items-center justify-between gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-xs text-red-600 dark:text-red-400">
            You have reached your alumni limit. Upgrade to add more capacity.
          </p>
          <Button variant="primary" size="sm" onClick={onUpgrade}>
            Upgrade Bucket
          </Button>
        </div>
      )}
      {percentage >= 90 && percentage < 100 && (
        <p className="text-xs text-red-600 dark:text-red-400">
          You are approaching your alumni limit. Consider upgrading your bucket.
        </p>
      )}
      {percentage >= 70 && percentage < 90 && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          You are using {displayPercentage}% of your alumni quota.
        </p>
      )}
    </div>
  );
}
