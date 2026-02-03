import { Button } from "@/components/ui";
import type { PricingModel } from "@/types/enterprise";
import { ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";

interface SeatUsageBarProps {
  currentSeats: number;
  maxSeats: number | null;
  pricingModel: PricingModel;
  onAddSeats?: () => void;
  className?: string;
}

function getUsagePercentage(current: number, max: number | null): number {
  if (max === null || max === 0) {
    return 0;
  }
  return Math.min((current / max) * 100, 100);
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

export function SeatUsageBar({
  currentSeats,
  maxSeats,
  pricingModel,
  onAddSeats,
  className = "",
}: SeatUsageBarProps) {
  const isUnlimited = maxSeats === null;
  const percentage = getUsagePercentage(currentSeats, maxSeats);
  const displayPercentage = Math.round(percentage);
  const showAddSeatsButton = pricingModel === "per_sub_org" && onAddSeats;

  // Calculate free tier info
  const freeOrgs = ENTERPRISE_SEAT_PRICING.freeSubOrgs;
  const freeOrgsUsed = Math.min(currentSeats, freeOrgs);
  const paidOrgsUsed = Math.max(0, currentSeats - freeOrgs);
  const totalCapacity = maxSeats ?? currentSeats;
  const paidCapacity = Math.max(0, totalCapacity - freeOrgs);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-foreground font-medium">Enterprise-managed organizations</span>
            {isUnlimited ? (
              <span className="text-muted-foreground">
                {currentSeats} <span className="text-purple-600 dark:text-purple-400">(unlimited)</span>
              </span>
            ) : (
              <span className={getUsageTextColor(percentage)}>
                {currentSeats} of {maxSeats} ({freeOrgs} free included)
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

          {/* Free tier breakdown */}
          {pricingModel === "per_sub_org" && !isUnlimited && (
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="text-green-600 dark:text-green-400">
                {freeOrgsUsed} of {freeOrgs} free
              </span>
              {paidCapacity > 0 && (
                <span className="ml-2">
                  + {paidOrgsUsed} of {paidCapacity} paid @ $150/yr each
                </span>
              )}
            </div>
          )}
        </div>

        {showAddSeatsButton && (
          <div className="ml-4 flex-shrink-0">
            <Button variant="secondary" size="sm" onClick={onAddSeats}>
              Add Seats
            </Button>
          </div>
        )}
      </div>

      {!isUnlimited && percentage >= 90 && (
        <p className="text-xs text-red-600 dark:text-red-400">
          You are approaching your seat limit. Consider adding more seats.
        </p>
      )}
      {!isUnlimited && percentage >= 70 && percentage < 90 && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          You are using {displayPercentage}% of your organization seats.
        </p>
      )}
    </div>
  );
}
