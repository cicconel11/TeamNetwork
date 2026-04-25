import {
  getMentorshipSectionOrder,
  normalizeMentorshipStatus,
  partitionPairableOrgMembers,
  type PairableOrgMemberRow,
} from "@teammeet/core";
import {
  canCreateMentorshipLog,
  partitionMentorshipPairs,
} from "@/lib/mentorship";

describe("mentorship parity rules", () => {
  test("mobile uses the same section ordering as web", () => {
    expect(getMentorshipSectionOrder({ hasPairs: true, isAdmin: false })).toBe(
      "pairs-first"
    );
    expect(getMentorshipSectionOrder({ hasPairs: true, isAdmin: true })).toBe(
      "directory-first"
    );
    expect(getMentorshipSectionOrder({ hasPairs: false, isAdmin: false })).toBe(
      "directory-first"
    );
  });

  test("mobile pairable member rules include admins as mentors and active members as mentees", () => {
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

    expect(result.mentors.map((member) => member.user_id)).toEqual([
      "admin-1",
      "alumni-1",
    ]);
    expect(result.mentees.map((member) => member.user_id)).toEqual(["member-1"]);
  });

  test("unexpected statuses normalize to active", () => {
    expect(normalizeMentorshipStatus("paused")).toBe("paused");
    expect(normalizeMentorshipStatus("completed")).toBe("completed");
    expect(normalizeMentorshipStatus("weird")).toBe("active");
  });

  test("proposal rows stay out of working pair views", () => {
    const pairs = [
      { id: "working-1", status: "active" },
      { id: "working-2", status: "paused" },
      { id: "proposal-1", status: "proposed" },
      { id: "proposal-2", status: "declined" },
      { id: "proposal-3", status: "expired" },
    ];

    const { workingPairs, proposalPairs } = partitionMentorshipPairs(pairs);

    expect(workingPairs.map((pair) => pair.id)).toEqual(["working-1", "working-2"]);
    expect(proposalPairs.map((pair) => pair.id)).toEqual([
      "proposal-1",
      "proposal-2",
      "proposal-3",
    ]);
  });

  test("only admins and active members can create logs for active pairs", () => {
    expect(
      canCreateMentorshipLog({ role: "active_member", status: "active" })
    ).toBe(true);
    expect(canCreateMentorshipLog({ role: "admin", status: "active" })).toBe(
      true
    );
    expect(canCreateMentorshipLog({ role: "alumni", status: "active" })).toBe(
      false
    );
    expect(
      canCreateMentorshipLog({ role: "active_member", status: "paused" })
    ).toBe(false);
  });
});
