import assert from "node:assert/strict";
import test from "node:test";
import {
  enterpriseIdSchema,
  memberIdSchema,
  orgIdSchema,
  userIdSchema,
  uuidSchema,
  type OrgId,
  type UserId,
} from "../src/lib/schemas/common";

const validUuid = "123e4567-e89b-12d3-a456-426614174000";

test("branded ID schemas validate UUIDs at the boundary", () => {
  assert.equal(orgIdSchema.parse(validUuid), validUuid);
  assert.equal(userIdSchema.parse(validUuid), validUuid);
  assert.equal(memberIdSchema.parse(validUuid), validUuid);
  assert.equal(enterpriseIdSchema.parse(validUuid), validUuid);

  assert.equal(orgIdSchema.safeParse("not-a-uuid").success, false);
});

test("branded IDs remain strings at runtime", () => {
  const orgId = orgIdSchema.parse(validUuid);
  const userId = userIdSchema.parse(validUuid);

  const acceptsString = (value: string) => value.toUpperCase();

  assert.equal(acceptsString(orgId), validUuid.toUpperCase());
  assert.equal(acceptsString(userId), validUuid.toUpperCase());
});

test("uuidSchema provides an unbranded UUID parser for generic boundaries", () => {
  assert.equal(uuidSchema.parse(validUuid), validUuid);
});

// Compile-time assertion: these assignments should stay valid only through schema parsing.
const _orgId: OrgId = orgIdSchema.parse(validUuid);
const _userId: UserId = userIdSchema.parse(validUuid);
void [_orgId, _userId];
