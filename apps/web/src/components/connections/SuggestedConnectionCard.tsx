import { MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DisplayReadySuggestedConnection } from "@/lib/people-graph/scoring";

interface SuggestedConnectionCardProps {
  suggestion: DisplayReadySuggestedConnection;
  orgId: string;
  orgSlug: string;
  messageLabel: string;
}

/**
 * One scored connection suggestion: avatar, name, subtitle, reason chips, and a
 * Message action. The Message button is a plain form POST to the existing
 * direct-chat/profile route (which resolves person_id → user_id and re-checks
 * chat eligibility server-side, then 303-redirects into the thread). No client
 * JS needed — this stays a server component.
 */
export function SuggestedConnectionCard({
  suggestion,
  orgId,
  orgSlug,
  messageLabel,
}: SuggestedConnectionCardProps) {
  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar src={null} name={suggestion.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{suggestion.name}</p>
          {suggestion.subtitle && (
            <p className="truncate text-xs text-muted-foreground">{suggestion.subtitle}</p>
          )}
        </div>
      </div>

      {suggestion.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestion.reasons.map((reason) => (
            <Badge key={reason.code} variant="muted">
              {reason.label}
            </Badge>
          ))}
        </div>
      )}

      <form
        action={`/api/organizations/${orgId}/direct-chat/profile`}
        method="post"
        className="mt-auto"
      >
        <input type="hidden" name="profileType" value={suggestion.person_type} />
        <input type="hidden" name="profileId" value={suggestion.person_id} />
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <Button type="submit" variant="secondary" size="sm" className="w-full">
          <MessageCircle className="mr-1.5 h-4 w-4" />
          {messageLabel}
        </Button>
      </form>
    </Card>
  );
}
