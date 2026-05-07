"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";

interface NonSubmittersProps {
  orgId: string;
  submitterUserIds: string[];
}

interface MemberInfo {
  user_id: string;
  users: { name: string | null; email: string } | null;
}

export function NonSubmitters({ orgId, submitterUserIds }: NonSubmittersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      setIsLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("organization_members")
        .select("user_id, users(name, email)")
        .eq("organization_id", orgId)
        .eq("status", "active");

      if (data) {
        const submitterSet = new Set(submitterUserIds);
        const nonSubmitters = (data as unknown as MemberInfo[]).filter(
          (m) => !submitterSet.has(m.user_id)
        );
        setMembers(nonSubmitters);
      }
      setIsLoading(false);
    };

    load();
  }, [isOpen, orgId, submitterUserIds]);

  const count = members.length;

  return (
    <Card padding="none" className="overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm font-medium text-muted-foreground">
          Who hasn&apos;t submitted {isOpen && count > 0 ? `(${count})` : ""}
        </span>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 border-t border-border">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-2">Loading...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Everyone has submitted!</p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.user_id} className="py-2 text-sm text-foreground">
                  {m.users?.name || m.users?.email || "Unknown member"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
