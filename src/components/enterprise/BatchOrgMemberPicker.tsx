"use client";

import { useState, useMemo } from "react";
import type { EnterpriseMember } from "./BatchOrgWizard";

interface SelectedMember {
  userId: string;
  sourceOrgId: string;
  action: "move" | "copy";
}

interface BatchOrgMemberPickerProps {
  members: EnterpriseMember[];
  selectedMembers: SelectedMember[];
  onChange: (selected: SelectedMember[]) => void;
}

export function BatchOrgMemberPicker({
  members,
  selectedMembers,
  onChange,
}: BatchOrgMemberPickerProps) {
  const [search, setSearch] = useState("");

  const filteredMembers = useMemo(() => {
    if (!search) return members;
    const query = search.toLowerCase();
    return members.filter(
      (m) =>
        m.fullName.toLowerCase().includes(query) ||
        m.email.toLowerCase().includes(query)
    );
  }, [members, search]);

  const selectedMap = useMemo(
    () => new Map(selectedMembers.map((m) => [m.userId, m])),
    [selectedMembers]
  );

  const toggleMember = (member: EnterpriseMember) => {
    if (selectedMap.has(member.userId)) {
      onChange(selectedMembers.filter((m) => m.userId !== member.userId));
    } else {
      const sourceOrg =
        member.organizations.length === 1 ? member.organizations[0] : null;
      onChange([
        ...selectedMembers,
        {
          userId: member.userId,
          sourceOrgId: sourceOrg?.orgId ?? "",
          action: "copy",
        },
      ]);
    }
  };

  const updateAction = (userId: string, action: "move" | "copy") => {
    onChange(
      selectedMembers.map((m) =>
        m.userId === userId ? { ...m, action } : m
      )
    );
  };

  const updateSourceOrg = (userId: string, sourceOrgId: string) => {
    onChange(
      selectedMembers.map((m) =>
        m.userId === userId ? { ...m, sourceOrgId } : m
      )
    );
  };

  const unresolvedSelections = selectedMembers.filter(
    (selectedMember) => !selectedMember.sourceOrgId.trim()
  ).length;

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
        {filteredMembers.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            {search ? "No members match your search" : "No members available"}
          </p>
        ) : (
          filteredMembers.map((member) => {
            const selected = selectedMap.get(member.userId);
            const isSelected = !!selected;
            const missingSourceSelection =
              isSelected &&
              member.organizations.length > 1 &&
              !selected!.sourceOrgId.trim();

            return (
              <div
                key={member.userId}
                className={`flex items-center gap-3 px-3 py-2 ${
                  isSelected ? "bg-blue-50 dark:bg-blue-900/10" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleMember(member)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {member.fullName || member.email}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {member.email}
                    {member.organizations.length > 0 && (
                      <span> · {member.organizations.map((o) => o.orgName).join(", ")}</span>
                    )}
                  </p>
                </div>

                {isSelected && (
                  <div className="flex items-center gap-2">
                    {member.organizations.length > 1 && (
                      <select
                        value={selected!.sourceOrgId}
                        onChange={(e) => updateSourceOrg(member.userId, e.target.value)}
                        className={`text-xs rounded bg-white dark:bg-gray-800 px-1 py-1 text-gray-700 dark:text-gray-300 ${
                          missingSourceSelection
                            ? "border border-red-400 dark:border-red-500"
                            : "border border-gray-300 dark:border-gray-600"
                        }`}
                      >
                        <option value="">Select source org</option>
                        {member.organizations.map((org) => (
                          <option key={org.orgId} value={org.orgId}>
                            {org.orgName}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateAction(member.userId, "copy")}
                        className={`px-2 py-1 text-xs rounded ${
                          selected!.action === "copy"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                        }`}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAction(member.userId, "move")}
                        className={`px-2 py-1 text-xs rounded ${
                          selected!.action === "move"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                        }`}
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {selectedMembers.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {selectedMembers.length} selected
            {" "}({selectedMembers.filter((m) => m.action === "move").length} move,
            {" "}{selectedMembers.filter((m) => m.action === "copy").length} copy)
          </p>
          {unresolvedSelections > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Select a source organization for {unresolvedSelections} member{unresolvedSelections === 1 ? "" : "s"} before continuing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
