import { Badge } from "@/components/ui";
import type { VendorType } from "@/hooks";

type VendorBadgeProps = {
  vendor: VendorType;
};

export function vendorLabel(vendor: VendorType): string {
  switch (vendor) {
    case "ics":
      return "ICS";
    case "vendorA":
      return "Vantage";
    case "vendorB":
      return "Sidearm";
    case "generic_html":
      return "HTML";
    case "google_calendar":
      return "Google Calendar";
    default:
      return "Schedule";
  }
}

export function VendorBadge({ vendor }: VendorBadgeProps) {
  return <Badge variant="muted">{vendorLabel(vendor)}</Badge>;
}
