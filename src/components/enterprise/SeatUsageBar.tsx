import { Button } from "@/components/ui";
import { ENTERPRISE_SEAT_PRICING, type BillingInterval } from "@/types/enterprise";

interface SeatUsageBarProps {
  currentSeats: number;
  billingInterval: BillingInterval;
  onAddSeats?: () => void;
  className?: string;
}

function PerSubOrgUsageBar({
  currentSeats,
  billingInterval,
  onAddSeats,
}: {
  currentSeats: number;
  billingInterval: BillingInterval;
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
                + {paidOrgsUsed} paid @ {billingInterval === "month" ? "$15/mo" : "$150/yr"} each
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

export function SeatUsageBar({
  currentSeats,
  billingInterval,
  onAddSeats,
  className = "",
}: SeatUsageBarProps) {
  return (
    <div className={className}>
      <PerSubOrgUsageBar
        currentSeats={currentSeats}
        billingInterval={billingInterval}
        onAddSeats={onAddSeats}
      />
    </div>
  );
}
