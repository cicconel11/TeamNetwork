import test from "node:test";
import assert from "node:assert/strict";
import {
  memberDisplayLabel,
  partitionPairableOrgMembers,
  type PairableOrgMemberRow,
} from "@teammeet/core";

test("partitionPairableOrgMembers keeps admins and alumni in mentor options", () => {
  const rows: PairableOrgMemberRow[] = [
    {
      user_id: "admin-1",
      role: "admin",
      users: { name: "Admin Mentor", email: "admin@example.com" },
    },
    {
      user_id: "alumni-1",
      role: "alumni",
      users: { name: "Alumni Mentor", email: "alumni@example.com" },
    },
    {
      user_id: "member-1",
      role: "active_member",
      users: { name: "Active Mentee", email: "member@example.com" },
    },
  ];

  const result = partitionPairableOrgMembers(rows);

  assert.deepEqual(
    result.mentors.map((member) => member.user_id),
    ["admin-1", "alumni-1"]
  );
  assert.deepEqual(
    result.mentees.map((member) => member.user_id),
    ["member-1"]
  );
});

test("memberDisplayLabel falls back from name to email to Member", () => {
  assert.equal(
    memberDisplayLabel({ user_id: "1", name: "Casey", email: "casey@example.com" }),
    "Casey"
  );
  assert.equal(
    memberDisplayLabel({ user_id: "1", name: null, email: "casey@example.com" }),
    "casey@example.com"
  );
  assert.equal(memberDisplayLabel({ user_id: "1", name: null, email: null }), "Member");
});
