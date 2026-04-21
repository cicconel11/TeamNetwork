export interface BatchExistingMemberAssignment {
  userId: string;
  sourceOrgId: string;
  action: "move" | "copy";
}

export interface BatchEmailInviteAssignment {
  email: string;
  role: "admin" | "active_member" | "alumni";
}

export interface BatchOrgMemberAssignment {
  orgIndex: number;
  existingMembers?: BatchExistingMemberAssignment[];
  emailInvites?: BatchEmailInviteAssignment[];
}

export function findBatchAssignmentIssues(
  organizationCount: number,
  memberAssignments: BatchOrgMemberAssignment[]
): string[] {
  const issues: string[] = [];

  memberAssignments.forEach((assignment, assignmentIndex) => {
    if (assignment.orgIndex < 0 || assignment.orgIndex >= organizationCount) {
      issues.push(
        `Assignment ${assignmentIndex + 1} references an organization that is not in this batch.`
      );
    }

    assignment.existingMembers?.forEach((member) => {
      if (!member.sourceOrgId.trim()) {
        issues.push(
          `Select a source organization for member ${member.userId} before continuing.`
        );
      }
    });
  });

  return issues;
}
