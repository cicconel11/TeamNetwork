import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";

interface MemberHighlight {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  created_at: string | null;
}

interface MemberHighlightsWidgetProps {
  members: MemberHighlight[];
  orgSlug: string;
}

function formatJoinDate(dateString: string): { text: string; isRecent: boolean } {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { text: "Joined today", isRecent: true };
  if (diffDays === 1) return { text: "Joined yesterday", isRecent: true };
  if (diffDays < 7) return { text: `Joined ${diffDays}d ago`, isRecent: true };
  if (diffDays < 30) return { text: `Joined ${diffDays}d ago`, isRecent: false };
  return { text: `Joined ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, isRecent: false };
}

export function MemberHighlightsWidget({ members, orgSlug }: MemberHighlightsWidgetProps) {
  if (members.length === 0) {
    return (
      <Card interactive padding="md">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Members</h3>
        <p className="text-sm text-muted-foreground/60 mt-3">No recent members</p>
      </Card>
    );
  }

  return (
    <Card interactive padding="md">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Members</h3>
      <ul className="space-y-1 mt-3 stagger-children">
        {members.map((member) => {
          const joinInfo = member.created_at ? formatJoinDate(member.created_at) : null;
          return (
            <li key={member.id}>
              <Link
                href={`/${orgSlug}/members/${member.id}`}
                className="flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-muted transition-all duration-200"
              >
                <div className="relative flex-shrink-0">
                  <Avatar
                    src={member.photo_url}
                    name={`${member.first_name} ${member.last_name}`}
                    size="sm"
                  />
                  {joinInfo?.isRecent && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-org-secondary rounded-full border-2 border-card" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">
                    {member.first_name} {member.last_name}
                  </p>
                  {joinInfo && (
                    <p className="text-xs text-muted-foreground">{joinInfo.text}</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={`/${orgSlug}/members`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-org-secondary mt-3 pt-3 border-t border-border transition-colors duration-200"
      >
        See all members <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
