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

function getAlumniTierPercentage(current: number, max: number | null): number {
  if (max === null || max === 0) {
    return 0;
  }
  return Math.min((current / max) * 100, 100);
}

function getAlumniTierColor(percentage: number): string {
  if (percentage >= 90) {
    return "bg-red-500";
  }
  if (percentage >= 70) {
    return "bg-yellow-500";
  }
  return "bg-green-500";
}

function getAlumniTierTextColor(percentage: number): string {
  if (percentage >= 90) {
    return "text-red-600 dark:text-red-400";
  }
  if (percentage >= 70) {
    return "text-yellow-600 dark:text-yellow-400";
  }
  return "text-green-600 dark:text-green-400";
}

function PerSubOrgUsageBar({
  currentSeats,
  onAddSeats,
}: {
  currentSeats: number;
  onAddSeats?: () => void;
}) {
  const freeOrgs = ENTERPRISE_SEAT_PRICING.freeSubOrgs;
  const freeOrgsUsed = Math.min(currentSeats, freeOrgs);
  const paidOrgsUsed = Math.max(0, currentSeats - freeOrgs);
  const allFreeUsed = freeOrgsUsed >= freeOrgs;

  const freeBarColor = allFreeUsed
    ? "bg-amber-500"
    : "bg-green-500";
  const freeTextColor = allFreeUsed
    ? "text-amber-600 dark:text-amber-400"
    : "text-green-600 dark:text-green-400";

  // Segmented bar: 3 equal segments for free tier
  const freeSegmentPercent = (freeOrgsUsed / freeOrgs) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-foreground font-medium">Enterprise-managed organizations</span>
            <span className="text-muted-foreground font-mono">{currentSeats} total</span>
          </div>

          {/* Segmented bar */}
          <div className="flex gap-1 h-3">
            {/* Free tier segment */}
            <div className="flex-1 bg-muted rounded-full overflow-hidden" title={`${freeOrgsUsed} of ${freeOrgs} free`}>
              <div
                className={`h-full ${freeBarColor} transition-all duration-300 rounded-full`}
                style={{ width: `${freeSegmentPercent}%` }}
              />
            </div>

            {/* Paid segment indicator */}
            {paidOrgsUsed > 0 && (
              <div className="flex-1 bg-muted rounded-full overflow-hidden" title={`${paidOrgsUsed} paid`}>
                <div
                  className="h-full bg-purple-500 transition-all duration-300 rounded-full"
                  style={{ width: "100%" }}
                />
              </div>
            )}
          </div>

          {/* Breakdown text */}
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className={freeTextColor}>
              {freeOrgsUsed} of {freeOrgs} free
            </span>
            {paidOrgsUsed > 0 && (
              <span className="text-purple-600 dark:text-purple-400">
                + {paidOrgsUsed} paid @ $150/yr each
              </span>
            )}
          </div>
        </div>

        {onAddSeats && (
          <div className="ml-4 flex-shrink-0">
            <Button variant="secondary" size="sm" onClick={onAddSeats}>
              Add Organization
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AlumniTierUsageBar({
  currentSeats,
  maxSeats,
}: {
  currentSeats: number;
  maxSeats: number | null;
}) {
  const isUnlimited = maxSeats === null;
  const percentage = getAlumniTierPercentage(currentSeats, maxSeats);
  const displayPercentage = Math.round(percentage);

  return (
    <div className="space-y-3">
      <div className="flex-1">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-foreground font-medium">Enterprise-managed organizations</span>
          {isUnlimited ? (
            <span className="text-muted-foreground">
              {currentSeats} <span className="text-purple-600 dark:text-purple-400">(unlimited)</span>
            </span>
          ) : (
            <span className={getAlumniTierTextColor(percentage)}>
              {currentSeats} of {maxSeats}
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
              className={`h-full ${getAlumniTierColor(percentage)} transition-all duration-300`}
              style={{ width: `${percentage}%` }}
            />
          )}
        </div>
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

export function SeatUsageBar({
  currentSeats,
  maxSeats,
  pricingModel,
  onAddSeats,
  className = "",
}: SeatUsageBarProps) {
  return (
    <div className={className}>
      {pricingModel === "per_sub_org" ? (
        <PerSubOrgUsageBar
          currentSeats={currentSeats}
          onAddSeats={onAddSeats}
        />
      ) : (
        <AlumniTierUsageBar
          currentSeats={currentSeats}
          maxSeats={maxSeats}
        />
      )}
    </div>
  );
}
