import test from "node:test";
import assert from "node:assert/strict";
import { findBatchAssignmentIssues } from "@/lib/enterprise/batch-org-assignments";

test("findBatchAssignmentIssues rejects out-of-range org indexes", () => {
  const issues = findBatchAssignmentIssues(1, [
    {
      orgIndex: 2,
      existingMembers: [],
      emailInvites: [],
    },
  ]);

  assert.deepEqual(issues, [
    "Assignment 1 references an organization that is not in this batch.",
  ]);
});

test("findBatchAssignmentIssues requires explicit source org selection", () => {
  const issues = findBatchAssignmentIssues(2, [
    {
      orgIndex: 0,
      existingMembers: [
        {
          userId: "user-1",
          sourceOrgId: "",
          action: "copy",
        },
      ],
      emailInvites: [],
    },
  ]);

  assert.deepEqual(issues, [
    "Select a source organization for member user-1 before continuing.",
  ]);
});

test("findBatchAssignmentIssues accepts valid assignments", () => {
  const issues = findBatchAssignmentIssues(2, [
    {
      orgIndex: 1,
      existingMembers: [
        {
          userId: "user-1",
          sourceOrgId: "org-1",
          action: "move",
        },
      ],
      emailInvites: [{ email: "user@example.com", role: "active_member" }],
    },
  ]);

  assert.deepEqual(issues, []);
});
