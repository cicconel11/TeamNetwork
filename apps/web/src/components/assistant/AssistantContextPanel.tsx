"use client";

import { Building2, CircleDashed, ListTodo, Quote, UserRound } from "lucide-react";
import type { OrgRole } from "@/lib/auth/role-utils";

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  active_member: "Member",
  alumni: "Alumni",
  parent: "Parent",
};

interface AssistantContextPanelProps {
  orgName: string;
  userRole: OrgRole | null;
  activeWorkflowLabel: string | null;
  pendingActionsCount: number;
}

function ContextSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-background/50 px-3 py-2.5">
      <h3 className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {icon}
        {title}
      </h3>
      <div className="mt-1.5 text-sm text-foreground">{children}</div>
    </section>
  );
}

export function AssistantContextPanel({
  orgName,
  userRole,
  activeWorkflowLabel,
  pendingActionsCount,
}: AssistantContextPanelProps) {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/50 bg-card/50 p-4 backdrop-blur-sm xl:flex">
      <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">
        Context
      </h2>

      <ContextSection icon={<Building2 className="h-3.5 w-3.5" />} title="Organization">
        <p className="truncate font-medium">{orgName}</p>
      </ContextSection>

      <ContextSection icon={<UserRound className="h-3.5 w-3.5" />} title="Your role">
        <p>{userRole ? ROLE_LABELS[userRole] : "Admin"}</p>
      </ContextSection>

      <ContextSection icon={<CircleDashed className="h-3.5 w-3.5" />} title="Active workflow">
        {activeWorkflowLabel ? (
          <p className="font-medium text-org-secondary">{activeWorkflowLabel}</p>
        ) : (
          <p className="text-muted-foreground">None — pick a workflow or just ask.</p>
        )}
      </ContextSection>

      <ContextSection icon={<ListTodo className="h-3.5 w-3.5" />} title="Pending actions">
        {pendingActionsCount > 0 ? (
          <p>
            <span className="font-medium text-org-secondary">{pendingActionsCount}</span> awaiting
            confirmation in the conversation.
          </p>
        ) : (
          <p className="text-muted-foreground">Nothing awaiting confirmation.</p>
        )}
      </ContextSection>

      <ContextSection icon={<Quote className="h-3.5 w-3.5" />} title="Sources">
        <p className="text-muted-foreground">
          Sources used by the assistant will appear here.
        </p>
      </ContextSection>
    </aside>
  );
}
