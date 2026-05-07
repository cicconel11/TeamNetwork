import test from "node:test";
import assert from "node:assert/strict";
import { sendBatchOrgInvites } from "@/lib/enterprise/batch-org-invites";

test("sendBatchOrgInvites sends email invites using one invite per role group", async () => {
  const inviteCalls: Array<{ orgId: string; role: string; uses: number }> = [];
  const emailCalls: string[] = [];

  const results = await sendBatchOrgInvites({
    baseUrl: "https://example.com",
    emailDeliveryEnabled: true,
    targets: [
      {
        orgId: "org-1",
        orgSlug: "alpha",
        orgName: "Alpha Org",
        recipients: [
          { email: "one@example.com", role: "active_member" },
          { email: "two@example.com", role: "active_member" },
        ],
      },
    ],
    createInvite: async ({ orgId, role, uses }) => {
      inviteCalls.push({ orgId, role, uses });
      return {
        invite: {
          code: "ABC12345",
          token: "token-1",
        },
      };
    },
    sendEmailFn: async ({ to }) => {
      emailCalls.push(to);
      return { success: true };
    },
  });

  assert.deepEqual(inviteCalls, [
    { orgId: "org-1", role: "active_member", uses: 2 },
  ]);
  assert.deepEqual(emailCalls, ["one@example.com", "two@example.com"]);
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.status === "sent"));
  assert.ok(results.every((result) => result.link?.includes("token=token-1")));
});

test("sendBatchOrgInvites returns skipped results with fallback links when email delivery is disabled", async () => {
  const results = await sendBatchOrgInvites({
    baseUrl: "https://example.com",
    emailDeliveryEnabled: false,
    targets: [
      {
        orgId: "org-1",
        orgSlug: "alpha",
        orgName: "Alpha Org",
        recipients: [{ email: "one@example.com", role: "active_member" }],
      },
    ],
    createInvite: async () => ({
      invite: {
        code: "ABC12345",
        token: null,
      },
    }),
    sendEmailFn: async () => {
      throw new Error("sendEmailFn should not be called when email delivery is disabled");
    },
  });

  assert.deepEqual(results, [
    {
      orgSlug: "alpha",
      email: "one@example.com",
      role: "active_member",
      status: "skipped",
      ok: true,
      code: "ABC12345",
      link: "https://example.com/app/join?code=ABC12345",
    },
  ]);
});

test("sendBatchOrgInvites reports invite creation failures per recipient", async () => {
  const results = await sendBatchOrgInvites({
    baseUrl: "https://example.com",
    emailDeliveryEnabled: true,
    targets: [
      {
        orgId: "org-1",
        orgSlug: "alpha",
        orgName: "Alpha Org",
        recipients: [{ email: "one@example.com", role: "active_member" }],
      },
    ],
    createInvite: async () => ({
      invite: null,
      error: "Invite creation failed",
    }),
    sendEmailFn: async () => ({ success: true }),
  });

  assert.deepEqual(results, [
    {
      orgSlug: "alpha",
      email: "one@example.com",
      role: "active_member",
      status: "failed",
      ok: false,
      code: null,
      link: null,
      error: "Invite creation failed",
    },
  ]);
});
