"use client";

import { useState } from "react";
import { BatchOrgMemberPicker } from "./BatchOrgMemberPicker";
import type { OrgFormData, MemberAssignment, EnterpriseMember } from "./BatchOrgWizard";

interface BatchOrgAssignStepProps {
  organizations: OrgFormData[];
  members: EnterpriseMember[];
  memberAssignments: MemberAssignment[];
  onAssignmentsChange: (assignments: MemberAssignment[]) => void;
}

export function BatchOrgAssignStep({
  organizations,
  members,
  memberAssignments,
  onAssignmentsChange,
}: BatchOrgAssignStepProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [emailInputs, setEmailInputs] = useState<Record<number, string>>({});

  const getAssignment = (orgIndex: number): MemberAssignment => {
    return (
      memberAssignments.find((a) => a.orgIndex === orgIndex) ?? {
        orgIndex,
        existingMembers: [],
        emailInvites: [],
      }
    );
  };

  const updateAssignment = (orgIndex: number, update: Partial<MemberAssignment>) => {
    const existing = getAssignment(orgIndex);
    const updated = { ...existing, ...update, orgIndex };
    const newAssignments = memberAssignments.filter((a) => a.orgIndex !== orgIndex);
    newAssignments.push(updated);
    onAssignmentsChange(newAssignments);
  };

  const handleEmailsChange = (orgIndex: number, text: string) => {
    setEmailInputs((prev) => ({ ...prev, [orgIndex]: text }));
    const emails = text
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));

    updateAssignment(orgIndex, {
      emailInvites: emails.map((email) => ({ email, role: "active_member" as const })),
    });
  };

  if (organizations.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-center py-8">
        No organizations defined. Go back to add organizations first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Optionally assign existing members or invite new ones. You can skip this step and add members later.
      </p>

      {/* Org tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {organizations.map((org, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveTab(i)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition ${
              activeTab === i
                ? "border-blue-500 text-blue-600 dark:text-blue-400 font-medium"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {org.name || `Org ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Active org's assignment panel */}
      {organizations.map((org, orgIndex) => (
        <div key={orgIndex} style={{ display: activeTab === orgIndex ? "block" : "none" }}>
          <div className="space-y-4">
            {/* Existing members */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Existing Enterprise Members
              </h4>
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
                  No existing members found in this enterprise.
                </p>
              ) : (
                <BatchOrgMemberPicker
                  members={members}
                  selectedMembers={getAssignment(orgIndex).existingMembers}
                  onChange={(selected) =>
                    updateAssignment(orgIndex, { existingMembers: selected })
                  }
                />
              )}
            </div>

            {/* Email invites */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Invite by Email
              </h4>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="Enter email addresses, one per line"
                value={emailInputs[orgIndex] ?? ""}
                onChange={(e) => handleEmailsChange(orgIndex, e.target.value)}
              />
              {getAssignment(orgIndex).emailInvites.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {getAssignment(orgIndex).emailInvites.length} email(s) will receive invite codes
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
